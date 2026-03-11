/**
 * Soul Loader — Reads SoulSpec identity on boot
 *
 * Loads SOUL.md, IDENTITY.md, STYLE.md, and HEARTBEAT.md from the
 * soul/ directory and injects them as behavioral directives.
 */

import * as fs from "fs";
import * as path from "path";

export interface SoulIdentity {
  name: string;
  personality: string;
  identity: string;
  style: string;
  heartbeat: string;
}

const SOUL_DIR = path.resolve("soul");

/** Load Soul identity from the soul/ directory */
export function loadSoul(): SoulIdentity | null {
  const soulMdPath = path.join(SOUL_DIR, "SOUL.md");

  if (!fs.existsSync(soulMdPath)) {
    console.log("[soul] No SOUL.md found — using defaults");
    return null;
  }

  const personality = readSoulFile("SOUL.md");
  const identity = readSoulFile("IDENTITY.md");
  const style = readSoulFile("STYLE.md");
  const heartbeat = readSoulFile("HEARTBEAT.md");

  // Read name from soul.json
  let name = "eighteen-core";
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(SOUL_DIR, "soul.json"), "utf-8"));
    name = manifest.name || name;
  } catch {
    // Use default name
  }

  const firstLine = personality.split("\n").find((l) => l.trim() && !l.startsWith("#")) || personality;
  console.log(`[soul] Soul loaded: ${firstLine.trim().substring(0, 80)}`);

  return { name, personality, identity, style, heartbeat };
}

function readSoulFile(filename: string): string {
  try {
    return fs.readFileSync(path.join(SOUL_DIR, filename), "utf-8");
  } catch {
    return "";
  }
}
