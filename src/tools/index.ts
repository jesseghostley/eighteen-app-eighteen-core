/**
 * Tool Registry — Local Tool Execution
 *
 * Handles tools that run locally (fast, no GitHub roundtrip):
 * - read: Read file contents
 * - grep: Search file contents
 * - glob: Find files by pattern
 * - web_search: Search the web
 * - message: Send a message to a channel
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
      name: "web_search",
      description: "Search the web for information",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
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

function toolWebSearch(_args: Record<string, unknown>): ToolCallResult {
  // Placeholder — web search requires an API integration
  return {
    tool: "web_search",
    success: false,
    output: "",
    error: "Web search not yet implemented. Configure a search API provider.",
  };
}
