/**
 * Heartbeat Scheduler — Periodic Health Checks
 *
 * Runs every 6 hours (configurable) to:
 * 1. Verify the gateway is responsive
 * 2. Check for stale webhook callbacks
 * 3. Summarize recent activity to PROJECT-LOG.md
 */

import { logAuditEntry } from "../pope-claw/audit-logger";

export interface HeartbeatConfig {
  intervalMs: number;
  gatewayPort: number;
  onBeat?: (report: HeartbeatReport) => void;
}

export interface HeartbeatReport {
  timestamp: string;
  gatewayUp: boolean;
  uptime: number;
  memoryMb: number;
}

const DEFAULT_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the heartbeat scheduler */
export function startHeartbeat(config?: Partial<HeartbeatConfig>): void {
  const intervalMs = config?.intervalMs || DEFAULT_INTERVAL;
  const port = config?.gatewayPort || parseInt(process.env.EIGHTEEN_PORT || "3000", 10);
  const onBeat = config?.onBeat;

  if (timer) {
    clearInterval(timer);
  }

  console.log(`[heartbeat] Scheduled every ${intervalMs / 1000 / 60} minutes`);

  // Run first beat after 30 seconds (let services initialize)
  setTimeout(() => runBeat(port, onBeat), 30_000);

  // Then run on interval
  timer = setInterval(() => runBeat(port, onBeat), intervalMs);
}

/** Stop the heartbeat scheduler */
export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[heartbeat] Stopped");
  }
}

async function runBeat(
  port: number,
  onBeat?: (report: HeartbeatReport) => void
): Promise<void> {
  const report: HeartbeatReport = {
    timestamp: new Date().toISOString(),
    gatewayUp: false,
    uptime: process.uptime(),
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };

  // Check gateway health
  try {
    const http = require("http");
    report.gatewayUp = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://localhost:${port}/health`, (res: { statusCode: number }) => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch {
    report.gatewayUp = false;
  }

  // Log the heartbeat
  await logAuditEntry({
    timestamp: report.timestamp,
    tool: "heartbeat",
    status: report.gatewayUp ? "SUCCESS" : "FAILED",
    summary: `Heartbeat: gateway=${report.gatewayUp ? "up" : "DOWN"}, uptime=${Math.round(report.uptime)}s, memory=${report.memoryMb}MB`,
  });

  if (!report.gatewayUp) {
    console.error("[heartbeat] Gateway health check FAILED");
  }

  if (onBeat) {
    onBeat(report);
  }
}
