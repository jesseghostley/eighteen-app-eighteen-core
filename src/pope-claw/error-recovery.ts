/**
 * Pope-Claw Error Recovery — Self-Healing with Log Summarization
 *
 * When a GitHub Action fails, this module:
 * 1. Fetches the Action run logs
 * 2. Classifies the failure (transient vs permanent)
 * 3. For transient: auto-retries with exponential backoff
 * 4. For permanent: summarizes the error and asks the Director
 *
 * The Director stays in the "Director seat" — never sees raw CI logs.
 */

import { Octokit } from "@octokit/rest";
import { PopeClawConfig, ErrorContext, FailureType, ToolCallRequest } from "./types";
import { logAuditEntry } from "./audit-logger";
import { dispatchToGitHub } from "./github-dispatch";

/** Transient error patterns that warrant auto-retry */
const TRANSIENT_PATTERNS = [
  /network/i,
  /timeout/i,
  /rate limit/i,
  /429/,
  /503/,
  /ECONNRESET/,
  /runner.*unavailable/i,
  /could not resolve/i,
];

/** Classify a failure as transient or permanent */
export function classifyFailure(logs: string, exitCode: number): FailureType {
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(logs))) {
    return "transient";
  }

  // Non-zero exit with no transient pattern = permanent
  if (exitCode !== 0) {
    return "permanent";
  }

  return "permanent";
}

/** Fetch logs from a failed GitHub Actions run */
export async function fetchRunLogs(
  owner: string,
  repo: string,
  runId: number
): Promise<string> {
  const token = process.env.GITHUB_PAT;
  if (!token) return "(could not fetch logs — GITHUB_PAT not set)";

  const octokit = new Octokit({ auth: token });

  try {
    // Get the failed job's logs
    const { data: jobs } = await octokit.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId,
    });

    const failedJob = jobs.jobs.find((j) => j.conclusion === "failure");
    if (!failedJob) return "(no failed job found)";

    const { data: logs } = await octokit.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: failedJob.id,
    });

    // logs comes as a string
    return typeof logs === "string" ? logs : String(logs);
  } catch {
    return "(failed to fetch logs from GitHub)";
  }
}

/**
 * Summarize a failure for the Director.
 * In production this calls the LLM; for now it extracts key lines.
 */
export function summarizeFailure(context: ErrorContext): string {
  const { tool, logs, failureType, retryCount } = context;

  // Extract last meaningful error lines (skip timestamps and noise)
  const lines = logs.split("\n").filter((line) =>
    /error|fail|denied|not found|exception/i.test(line)
  );
  const errorSnippet = lines.slice(-3).join(" | ") || "Unknown error";

  const retryNote = failureType === "transient"
    ? ` (retry ${retryCount}/${2})`
    : " (permanent — needs Director input)";

  return `The \`${tool}\` action failed: ${errorSnippet}${retryNote}`;
}

/**
 * Build the Strategic Correction prompt for the Director.
 * Sent to chat when a permanent failure occurs.
 */
export function buildCorrectionPrompt(context: ErrorContext): string {
  const summary = summarizeFailure(context);

  return [
    summary,
    "",
    "Options:",
    "  (a) Retry the action",
    "  (b) Try a different approach",
    "  (c) Skip this for now",
  ].join("\n");
}

/**
 * Handle a failed tool execution with retry logic.
 * Returns the final result after retries are exhausted.
 */
export async function handleFailure(
  config: PopeClawConfig,
  request: ToolCallRequest,
  runId: number,
  logs: string,
  exitCode: number
): Promise<{ summary: string; shouldAskDirector: boolean }> {
  const [owner, repo] = config.remoteTool.repo.split("/");
  const failureType = classifyFailure(logs, exitCode);

  const context: ErrorContext = {
    tool: request.tool,
    runId,
    logs,
    exitCode,
    failureType,
    retryCount: 0,
  };

  // Log the initial failure
  await logAuditEntry({
    timestamp: new Date().toISOString(),
    tool: request.tool,
    status: "FAILED",
    summary: summarizeFailure(context),
    runId,
  });

  // Auto-retry for transient failures
  if (failureType === "transient") {
    const { maxRetries, backoffMs } = config.retryPolicy;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      context.retryCount = attempt + 1;
      const delay = backoffMs[attempt] || backoffMs[backoffMs.length - 1];

      await logAuditEntry({
        timestamp: new Date().toISOString(),
        tool: request.tool,
        status: "RETRY",
        summary: `Retrying after ${delay}ms (attempt ${context.retryCount}/${maxRetries})`,
        runId,
      });

      await sleep(delay);

      try {
        const retryResult = await dispatchToGitHub(config, request);
        if (retryResult.success) {
          return { summary: `Succeeded on retry ${context.retryCount}`, shouldAskDirector: false };
        }

        // Fetch new logs for the retry
        if (retryResult.runId) {
          logs = await fetchRunLogs(owner, repo, retryResult.runId);
        }
      } catch {
        // Retry failed — continue to next attempt
      }
    }
  }

  // All retries exhausted or permanent failure
  const correctionPrompt = buildCorrectionPrompt(context);
  return { summary: correctionPrompt, shouldAskDirector: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
