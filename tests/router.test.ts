/**
 * Unit Tests — Pope-Claw Router
 */

import * as assert from "assert";
import { PopeClawRouter } from "../src/pope-claw/router";
import { PopeClawConfig } from "../src/pope-claw/types";

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

const mockConfig: PopeClawConfig = {
  remoteTool: {
    enabled: true,
    repo: "test-owner/test-repo",
    branch: "audit/main",
    workflowId: "pope-claw-exec.yml",
    callbackUrl: "https://test.example.com/callback",
    timeoutMs: 5000,
  },
  remoteTools: ["bash", "write", "edit", "apply_patch"],
  localTools: ["read", "grep", "glob", "web_search"],
  retryPolicy: {
    maxRetries: 2,
    backoffMs: [100, 200],
  },
};

console.log("\n=== Router Tests ===\n");

test("isRemoteTool: correctly identifies remote tools", () => {
  const router = new PopeClawRouter(mockConfig);
  assert.strictEqual(router.isRemoteTool("bash"), true);
  assert.strictEqual(router.isRemoteTool("write"), true);
  assert.strictEqual(router.isRemoteTool("edit"), true);
  assert.strictEqual(router.isRemoteTool("apply_patch"), true);
});

test("isRemoteTool: correctly identifies local tools", () => {
  const router = new PopeClawRouter(mockConfig);
  assert.strictEqual(router.isRemoteTool("read"), false);
  assert.strictEqual(router.isRemoteTool("grep"), false);
  assert.strictEqual(router.isRemoteTool("glob"), false);
});

test("isRemoteTool: returns false when bridge disabled", () => {
  const disabledConfig = { ...mockConfig, remoteTool: { ...mockConfig.remoteTool, enabled: false } };
  const router = new PopeClawRouter(disabledConfig);
  assert.strictEqual(router.isRemoteTool("bash"), false);
});

test("isLocalTool: correctly identifies local tools", () => {
  const router = new PopeClawRouter(mockConfig);
  assert.strictEqual(router.isLocalTool("read"), true);
  assert.strictEqual(router.isLocalTool("grep"), true);
  assert.strictEqual(router.isLocalTool("bash"), false);
});

test("route: returns null for local tools", async () => {
  const router = new PopeClawRouter(mockConfig);
  const result = await router.route({
    tool: "read",
    args: { path: "test.txt" },
    sessionId: "test-session",
    callbackUrl: "",
  });
  assert.strictEqual(result, null);
});

console.log("");
