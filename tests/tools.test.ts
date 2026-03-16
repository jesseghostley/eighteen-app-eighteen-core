/**
 * Unit Tests — Local Tool Execution
 */

import * as assert from "assert";
import * as path from "path";
import { executeLocalTool, getToolDefinitions } from "../src/tools/index";

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

console.log("\n=== Tool Tests ===\n");

// --- getToolDefinitions ---

test("getToolDefinitions returns all tools", () => {
  const tools = getToolDefinitions();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("read"), "has read tool");
  assert.ok(names.includes("grep"), "has grep tool");
  assert.ok(names.includes("glob"), "has glob tool");
  assert.ok(names.includes("web_search"), "has web_search tool");
  assert.ok(names.includes("bash"), "has bash tool");
  assert.ok(names.includes("write"), "has write tool");
  assert.ok(names.includes("edit"), "has edit tool");
  assert.ok(names.includes("apply_patch"), "has apply_patch tool");
});

test("each tool has required fields", () => {
  const tools = getToolDefinitions();
  for (const tool of tools) {
    assert.ok(tool.name, `tool has name`);
    assert.ok(tool.description, `${tool.name} has description`);
    assert.ok(tool.input_schema, `${tool.name} has input_schema`);
  }
});

// --- read tool ---

test("read: reads an existing file", () => {
  const result = executeLocalTool("read", { path: path.resolve("package.json") });
  assert.strictEqual(result.success, true);
  assert.ok(result.output.includes("eighteen-core"), "output contains project name");
});

test("read: fails for nonexistent file", () => {
  const result = executeLocalTool("read", { path: "/nonexistent/file.txt" });
  assert.strictEqual(result.success, false);
  assert.ok(result.error, "has error message");
});

// --- grep tool ---

test("grep: finds pattern in codebase", () => {
  const result = executeLocalTool("grep", { pattern: "eighteen-core", path: "package.json" });
  assert.strictEqual(result.success, true);
  assert.ok(result.output.includes("eighteen-core"));
});

test("grep: returns no matches for garbage pattern", () => {
  const result = executeLocalTool("grep", { pattern: "zzz_xq9k_nonexistent_zzz", path: "src" });
  assert.strictEqual(result.success, true);
  assert.ok(result.output.includes("(no matches)"));
});

// --- glob tool ---

test("glob: finds TypeScript files", () => {
  const result = executeLocalTool("glob", { pattern: "*.ts", path: "src" });
  assert.strictEqual(result.success, true);
  assert.ok(result.output.includes(".ts"), "output contains .ts files");
});

test("glob: returns no matches for impossible pattern", () => {
  const result = executeLocalTool("glob", { pattern: "*.zzzzz", path: "." });
  assert.strictEqual(result.success, true);
  assert.ok(result.output.includes("(no matches)"));
});

// --- web_search tool ---

test("web_search: fails gracefully without API key", () => {
  // Remove API key if set
  const saved = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  const result = executeLocalTool("web_search", { query: "test" });
  assert.strictEqual(result.success, false);
  assert.ok(result.error?.includes("BRAVE_SEARCH_API_KEY"));
  if (saved) process.env.BRAVE_SEARCH_API_KEY = saved;
});

// --- unknown tool ---

test("unknown tool returns error", () => {
  const result = executeLocalTool("nonexistent", {});
  assert.strictEqual(result.success, false);
  assert.ok(result.error?.includes("Unknown local tool"));
});

console.log("");
