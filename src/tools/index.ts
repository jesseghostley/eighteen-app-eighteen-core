/**
 * Tool Registry — Local Tool Execution
 *
 * Handles tools that run locally (fast, no GitHub roundtrip):
 * - read: Read file contents
 * - grep: Search file contents
 * - glob: Find files by pattern
 * - web_search: Search the web (via Brave Search API)
 *
 * Remote tools (exec, bash, write, edit, apply_patch) are handled
 * by the Pope-Claw bridge and never reach this module.
 */

import * as fs from "fs";
import * as path from "path";
import { ToolCallResult } from "../pope-claw/types";

/** Tool definition for LLM tool_use */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** All tools available to the agent (local + remote definitions) */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    // Local tools
    {
      name: "read",
      description: "Read the contents of a file",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
    },
    {
      name: "grep",
      description: "Search for a pattern in files",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory or file to search in" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "glob",
      description: "Find files matching a glob pattern",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts, src/**/*.json)" },
          path: { type: "string", description: "Base directory to search in (default: current directory)" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "web_search",
      description: "Search the web for information using Brave Search",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "number", description: "Number of results (default 5, max 20)" },
        },
        required: ["query"],
      },
    },
    // Remote tools (Pope-Claw routes these to GitHub Actions)
    {
      name: "bash",
      description: "Execute a shell command (runs in GitHub Actions sandbox)",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
    },
    {
      name: "write",
      description: "Write content to a file (runs in GitHub Actions sandbox)",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "edit",
      description: "Edit a file with find/replace (runs in GitHub Actions sandbox)",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to edit" },
          old_string: { type: "string", description: "Text to find" },
          new_string: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    {
      name: "apply_patch",
      description: "Apply a git patch (runs in GitHub Actions sandbox)",
      input_schema: {
        type: "object",
        properties: {
          patch: { type: "string", description: "Git-format patch content" },
        },
        required: ["patch"],
      },
    },
  ];
}

/** Execute a local tool and return the result */
export function executeLocalTool(
  toolName: string,
  args: Record<string, unknown>
): ToolCallResult {
  switch (toolName) {
    case "read":
      return toolRead(args);
    case "grep":
      return toolGrep(args);
    case "glob":
      return toolGlob(args);
    case "web_search":
      return toolWebSearch(args);
    default:
      return {
        tool: toolName,
        success: false,
        output: "",
        error: `Unknown local tool: ${toolName}`,
      };
  }
}

function toolRead(args: Record<string, unknown>): ToolCallResult {
  const filePath = args.path as string;
  try {
    const resolved = path.resolve(filePath);
    const content = fs.readFileSync(resolved, "utf-8");
    return { tool: "read", success: true, output: content };
  } catch (err) {
    return {
      tool: "read",
      success: false,
      output: "",
      error: `Failed to read ${filePath}: ${err}`,
    };
  }
}

function toolGrep(args: Record<string, unknown>): ToolCallResult {
  const pattern = args.pattern as string;
  const searchPath = (args.path as string) || ".";

  try {
    const { execSync } = require("child_process");
    const output = execSync(`grep -rn "${pattern}" "${searchPath}" 2>/dev/null || true`, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });
    return { tool: "grep", success: true, output: output || "(no matches)" };
  } catch (err) {
    return {
      tool: "grep",
      success: false,
      output: "",
      error: `Grep failed: ${err}`,
    };
  }
}

function toolGlob(args: Record<string, unknown>): ToolCallResult {
  const pattern = args.pattern as string;
  const basePath = (args.path as string) || ".";

  try {
    const { execSync } = require("child_process");
    // Use find with shell glob expansion for cross-platform compatibility
    const output = execSync(
      `find "${basePath}" -type f -name "${pattern}" 2>/dev/null | head -200 | sort`,
      { encoding: "utf-8", maxBuffer: 1024 * 1024 }
    );
    const files = output.trim();
    return {
      tool: "glob",
      success: true,
      output: files || "(no matches)",
    };
  } catch (err) {
    return {
      tool: "glob",
      success: false,
      output: "",
      error: `Glob failed: ${err}`,
    };
  }
}

function toolWebSearch(args: Record<string, unknown>): ToolCallResult {
  const query = args.query as string;
  const count = Math.min((args.count as number) || 5, 20);

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return {
      tool: "web_search",
      success: false,
      output: "",
      error: "BRAVE_SEARCH_API_KEY not configured. Set it in .env to enable web search.",
    };
  }

  // Use synchronous HTTP via child_process to keep the tool interface simple
  try {
    const { execSync } = require("child_process");
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${count}`;
    const response = execSync(
      `curl -s -H "Accept: application/json" -H "X-Subscription-Token: ${apiKey}" "${url}"`,
      { encoding: "utf-8", maxBuffer: 2 * 1024 * 1024, timeout: 15000 }
    );

    const data = JSON.parse(response);
    if (data.web?.results) {
      const results = data.web.results.map((r: { title: string; url: string; description: string }) =>
        `**${r.title}**\n${r.url}\n${r.description}`
      ).join("\n\n");
      return { tool: "web_search", success: true, output: results };
    }

    return {
      tool: "web_search",
      success: true,
      output: data.query?.altered ? `No results. Did you mean: ${data.query.altered}` : "(no results)",
    };
  } catch (err) {
    return {
      tool: "web_search",
      success: false,
      output: "",
      error: `Web search failed: ${err}`,
    };
  }
}
