/**
 * Telegram Channel Adapter — grammY Integration
 *
 * Bridges Telegram messages to the Eighteen gateway handler.
 * Normalizes Telegram-specific context into a generic MessageContext.
 */

import { Bot, Context } from "grammy";
import { MessageHandler } from "../gateway/handler";

/** Create and configure the Telegram bot */
export function createTelegramBot(token: string, handler: MessageHandler): Bot {
  const bot = new Bot(token);

  bot.on("message:text", async (ctx: Context) => {
    const text = ctx.message?.text;
    if (!text) return;

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sessionId = `telegram-${chatId}-${Date.now()}`;

    await handler({
      text,
      sessionId,
      channelType: "telegram",
      sendReply: async (reply: string) => {
        // Split long messages (Telegram has a 4096 char limit)
        const chunks = splitMessage(reply, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        }
      },
    });
  });

  bot.catch((err) => {
    console.error("[telegram] Bot error:", err.message);
  });

  return bot;
}

/** Split long messages into chunks respecting Telegram's limit */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline near the limit
    let splitPoint = remaining.lastIndexOf("\n", maxLength);
    if (splitPoint < maxLength * 0.5) {
      // No good newline — split at space
      splitPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitPoint < maxLength * 0.5) {
      // No good space — hard split
      splitPoint = maxLength;
    }

    chunks.push(remaining.substring(0, splitPoint));
    remaining = remaining.substring(splitPoint).trimStart();
  }

  return chunks;
}
