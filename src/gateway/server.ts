/**
 * Eighteen Gateway — HTTP Server + Service Orchestrator
 *
 * The main entry point. Starts:
 * 1. Express HTTP server (webhook callbacks, health checks)
 * 2. Telegram bot (grammY)
 * 3. Pope-Claw bridge (if configured)
 * 4. Soul identity (loaded from soul/SOUL.md)
 */

import express from "express";
import { createHandler } from "./handler";
import { createWebhookRouter } from "../pope-claw/webhook-server";
import { createPopeClawBridge } from "../pope-claw/index";
import { createTelegramBot } from "../channels/telegram";
import { loadSoul } from "./soul-loader";

const PORT = parseInt(process.env.EIGHTEEN_PORT || "3000", 10);

export async function startGateway(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Load Soul identity
  const soul = loadSoul();

  // Initialize Pope-Claw bridge
  const bridge = createPopeClawBridge();

  // Create the message handler (processes incoming messages, routes tool calls)
  const handler = createHandler({ bridge, soul });

  // Mount webhook callback endpoint (only if bridge is active)
  if (bridge) {
    app.use("/api/pope-claw/callback", createWebhookRouter());
    console.log("[gateway] Pope-Claw webhook mounted at /api/pope-claw/callback");
  }

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      bridge: bridge ? "enabled" : "disabled",
      soul: soul ? soul.name : "default",
      uptime: process.uptime(),
    });
  });

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`[gateway] Eighteen Core listening on port ${PORT}`);
  });

  // Start Telegram bot (if token is configured)
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    const bot = createTelegramBot(telegramToken, handler);
    bot.start();
    console.log("[gateway] Telegram bot started");
  } else {
    console.log("[gateway] No TELEGRAM_BOT_TOKEN — Telegram disabled");
  }

  console.log("[gateway] Eighteen Core is running");
}

// Auto-start when run directly
startGateway().catch((err) => {
  console.error("[gateway] Failed to start:", err);
  process.exit(1);
});
