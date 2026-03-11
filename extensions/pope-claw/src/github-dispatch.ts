/**
 * Pope-Claw GitHub Dispatch — Repository Dispatch API Client
 *
 * Sends tool call requests to GitHub Actions via the repository_dispatch
 * event and polls for completion.
 */

import { Octokit } from "@octokit/rest";
import { PopeClawConfig, ToolCallRequest, ToolCallResult } from "./types";

/** Send a repository_dispatch event to trigger the pope-claw-exec workflow */
export async function dispatchToGitHub(
  config: PopeClawConfig,
  request: ToolCallRequest
): Promise<ToolCallResult> {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    throw new Error("GITHUB_PAT environment variable is not set");
  }

  const octokit = new Octokit({ auth: token });
  const [owner, repo] = config.remoteTool.repo.split("/");

  // Send the dispatch event
  await octokit.repos.createDispatchEvent({
    owner,
    repo,
    event_type: "pope-claw-exec",
    client_payload: {
      tool: request.tool,
      args: request.args,
      sessionId: request.sessionId,
      callbackUrl: request.callbackUrl || config.remoteTool.callbackUrl,
    },
  });

  // Poll for the workflow run triggered by this dispatch
  const runId = await pollForRun(octokit, owner, repo, config.remoteTool.timeoutMs);

  if (!runId) {
    return {
      tool: request.tool,
      success: false,
      output: "",
      error: "Timed out waiting for GitHub Action to start",
    };
  }

  // Wait for the run to complete
  const result = await waitForCompletion(octokit, owner, repo, runId, config.remoteTool.timeoutMs);
  return { ...result, tool: request.tool, runId };
}

/** Poll GitHub Actions for a recently triggered run */
async function pollForRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  timeoutMs: number
): Promise<number | null> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      event: "repository_dispatch",
      per_page: 1,
    });

    if (data.workflow_runs.length > 0) {
      const run = data.workflow_runs[0];
      const runCreatedAt = new Date(run.created_at).getTime();

      // Only match runs created after we dispatched (within 30s window)
      if (runCreatedAt > startTime - 30000) {
        return run.id;
      }
    }

    await sleep(pollInterval);
  }

  return null;
}

/** Wait for a workflow run to complete and return its result */
async function waitForCompletion(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
  timeoutMs: number
): Promise<ToolCallResult> {
  const startTime = Date.now();
  const pollInterval = 3000;

  while (Date.now() - startTime < timeoutMs) {
    const { data: run } = await octokit.actions.getWorkflowRun({
      owner,
      repo,
      run_id: runId,
    });

    if (run.status === "completed") {
      const success = run.conclusion === "success";

      // Fetch the output artifact or commit
      const output = await fetchRunOutput(octokit, owner, repo, runId);

      return {
        tool: "",
        success,
        output: output || "",
        error: success ? undefined : `Action concluded with: ${run.conclusion}`,
        runId,
        commitSha: run.head_sha,
      };
    }

    await sleep(pollInterval);
  }

  return {
    tool: "",
    success: false,
    output: "",
    error: `Timed out after ${timeoutMs}ms waiting for run ${runId} to complete`,
    runId,
  };
}

/** Fetch the output from a completed workflow run (reads workspace/output.txt from the audit branch) */
async function fetchRunOutput(
  octokit: Octokit,
  owner: string,
  repo: string,
  _runId: number
): Promise<string> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: "workspace/output.txt",
      ref: "audit/main",
    });

    if ("content" in data && data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch {
    // output.txt may not exist for all tool types
  }

  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
