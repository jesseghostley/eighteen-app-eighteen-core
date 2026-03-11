/**
 * Pope-Claw Audit Logger — Commit Message Formatter + PROJECT-LOG Writer
 *
 * Appends human-readable summaries to PROJECT-LOG.md after each
 * GitHub Action execution. Keeps the Director in the "Director seat"
 * with quick-scan summaries instead of raw CI logs.
 */

import * as fs from "fs";
import * as path from "path";
import { AuditEntry } from "./types";

const DEFAULT_LOG_PATH = "PROJECT-LOG.md";

/** Append an audit entry to PROJECT-LOG.md */
export async function logAuditEntry(
  entry: AuditEntry,
  logPath: string = DEFAULT_LOG_PATH
): Promise<void> {
  const line = formatLogEntry(entry);

  try {
    const resolvedPath = path.resolve(logPath);
    await fs.promises.appendFile(resolvedPath, line + "\n");
  } catch (err) {
    // Log locally if PROJECT-LOG.md isn't writable (e.g. during remote-only execution)
    console.error(`[pope-claw] Failed to write audit log: ${err}`);
    console.log(`[pope-claw] Audit entry: ${line}`);
  }
}

/** Format an audit entry as a human-readable log line */
function formatLogEntry(entry: AuditEntry): string {
  const tag = entry.status === "SUCCESS" ? "[OK]"
    : entry.status === "FAILED" ? "[FAILED]"
    : "[RETRY]";

  const parts = [
    `- ${entry.timestamp}`,
    tag,
    `\`${entry.tool}\``,
    `— ${entry.summary}`,
  ];

  if (entry.runId) {
    parts.push(`(run #${entry.runId})`);
  }

  if (entry.commitSha) {
    parts.push(`[${entry.commitSha.substring(0, 7)}]`);
  }

  return parts.join(" ");
}

/** Format a structured commit message for the audit branch */
export function formatCommitMessage(
  tool: string,
  args: Record<string, unknown>,
  success: boolean,
  output: string
): string {
  const status = success ? "success" : "failed";
  const preview = output.substring(0, 200).replace(/\n/g, " ");

  return [
    `[pope-claw] ${tool}: ${status}`,
    "",
    `Tool: ${tool}`,
    `Args: ${JSON.stringify(args)}`,
    `Status: ${status}`,
    `Output: ${preview}${output.length > 200 ? "..." : ""}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join("\n");
}
