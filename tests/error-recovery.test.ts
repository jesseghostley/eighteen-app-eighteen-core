/**
 * Unit Tests — Error Recovery
 */

import * as assert from "assert";
import { classifyFailure, summarizeFailure, buildCorrectionPrompt } from "../src/pope-claw/error-recovery";
import { ErrorContext } from "../src/pope-claw/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err}`);
    process.exitCode = 1;
  }
}

console.log("\n=== Error Recovery Tests ===\n");

// --- classifyFailure ---

test("classifyFailure: network error is transient", () => {
  assert.strictEqual(classifyFailure("network error: ECONNRESET", 1), "transient");
});

test("classifyFailure: timeout is transient", () => {
  assert.strictEqual(classifyFailure("Request timeout after 30s", 1), "transient");
});

test("classifyFailure: rate limit is transient", () => {
  assert.strictEqual(classifyFailure("Error 429: rate limit exceeded", 1), "transient");
});

test("classifyFailure: 503 is transient", () => {
  assert.strictEqual(classifyFailure("HTTP 503 Service Unavailable", 1), "transient");
});

test("classifyFailure: syntax error is permanent", () => {
  assert.strictEqual(classifyFailure("SyntaxError: unexpected token", 1), "permanent");
});

test("classifyFailure: permission denied is permanent", () => {
  assert.strictEqual(classifyFailure("Permission denied: cannot write to /etc", 1), "permanent");
});

// --- summarizeFailure ---

test("summarizeFailure: includes tool name", () => {
  const ctx: ErrorContext = {
    tool: "bash",
    runId: 123,
    logs: "Error: file not found",
    exitCode: 1,
    failureType: "permanent",
    retryCount: 0,
  };
  const summary = summarizeFailure(ctx);
  assert.ok(summary.includes("bash"), "includes tool name");
});

test("summarizeFailure: includes retry count for transient", () => {
  const ctx: ErrorContext = {
    tool: "write",
    runId: 456,
    logs: "network timeout",
    exitCode: 1,
    failureType: "transient",
    retryCount: 1,
  };
  const summary = summarizeFailure(ctx);
  assert.ok(summary.includes("retry 1"), "includes retry count");
});

// --- buildCorrectionPrompt ---

test("buildCorrectionPrompt: includes options for Director", () => {
  const ctx: ErrorContext = {
    tool: "edit",
    runId: 789,
    logs: "Error: permission denied",
    exitCode: 1,
    failureType: "permanent",
    retryCount: 0,
  };
  const prompt = buildCorrectionPrompt(ctx);
  assert.ok(prompt.includes("Retry"), "includes retry option");
  assert.ok(prompt.includes("different approach"), "includes alternative option");
  assert.ok(prompt.includes("Skip"), "includes skip option");
});

console.log("");
