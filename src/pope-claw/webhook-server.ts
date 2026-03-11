/**
 * Pope-Claw Webhook Server — Callback Receiver + HMAC Verification
 *
 * Receives POST callbacks from GitHub Actions after execution completes.
 * Verifies HMAC-SHA256 signatures to prevent spoofed callbacks.
 */

import { Router, Request, Response } from "express";
import * as crypto from "crypto";
import { WebhookPayload } from "./types";

/** Pending callback resolvers keyed by sessionId */
const pendingCallbacks = new Map<string, (payload: WebhookPayload) => void>();

/** Register a callback listener for a session */
export function waitForCallback(sessionId: string, timeoutMs: number): Promise<WebhookPayload | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCallbacks.delete(sessionId);
      resolve(null);
    }, timeoutMs);

    pendingCallbacks.set(sessionId, (payload) => {
      clearTimeout(timer);
      pendingCallbacks.delete(sessionId);
      resolve(payload);
    });
  });
}

/** Create the Express router for the webhook endpoint */
export function createWebhookRouter(): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    // Verify HMAC signature
    const secret = process.env.POPE_CLAW_WEBHOOK_SECRET;
    if (!secret) {
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    const signature = req.headers["x-pope-claw-signature"] as string;
    if (!signature) {
      res.status(401).json({ error: "Missing signature header" });
      return;
    }

    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

    // Signature valid — process the payload
    const payload = req.body as WebhookPayload;
    const resolver = pendingCallbacks.get(payload.sessionId);

    if (resolver) {
      resolver(payload);
      res.status(200).json({ received: true });
    } else {
      // No listener waiting — log and acknowledge
      console.log(`[pope-claw] Received callback for unknown session: ${payload.sessionId}`);
      res.status(200).json({ received: true, warning: "no pending listener" });
    }
  });

  return router;
}
