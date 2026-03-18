import * as crypto from 'crypto';

/**
 * ULID (Universally Unique Lexicographically Sortable Identifier) generator.
 *
 * Spec: https://github.com/ulid/spec
 * Format: 26-character Crockford Base32 string
 *   - 10 chars (48 bits) = millisecond timestamp
 *   - 16 chars (80 bits) = cryptographic randomness
 *
 * Properties:
 *   - Globally unique without coordination
 *   - Lexicographically sortable by creation time
 *   - No counters, no state, no database queries
 *   - Safe across restarts, processes, and machines
 *   - Uses crypto.randomBytes (not Math.random)
 *
 * This module is the SINGLE source of truth for all ID generation in GhostClaw.
 * Every runtime entity (signal, plan, job, artifact, etc.) MUST use uniqueId().
 */

// Crockford's Base32 alphabet (excludes I, L, O, U to avoid ambiguity)
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Encode a millisecond timestamp into 10 Crockford Base32 characters.
 */
function encodeTime(ms: number): string {
  let t = ms;
  const chars: string[] = new Array(10);
  for (let i = 9; i >= 0; i--) {
    chars[i] = CROCKFORD[t & 31]; // t % 32
    t = Math.floor(t / 32);
  }
  return chars.join('');
}

/**
 * Encode 10 random bytes into 16 Crockford Base32 characters.
 */
function encodeRandom(bytes: Buffer): string {
  // 10 bytes = 80 bits → 16 base32 chars (16 * 5 = 80 bits)
  const chars: string[] = new Array(16);
  // Process 5 bits at a time using bit manipulation
  // Each byte = 8 bits; we need to extract 5-bit groups across byte boundaries
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  let charIdx = 0;
  for (let i = 0; i < bytes.length && charIdx < 16; i++) {
    bitBuffer = (bitBuffer << 8) | bytes[i];
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5 && charIdx < 16) {
      bitsInBuffer -= 5;
      chars[charIdx++] = CROCKFORD[(bitBuffer >> bitsInBuffer) & 31];
    }
  }
  return chars.join('');
}

/**
 * Generate a ULID: 26-character globally unique, lexicographically sortable ID.
 *
 * Example: "01ARZ3NDEKTSV4RRFFQ69G5FAV"
 */
export function ulid(): string {
  const now = Date.now();
  const randomBytes = crypto.randomBytes(10);
  return encodeTime(now) + encodeRandom(randomBytes);
}

/**
 * Generate a prefixed ULID for a GhostClaw runtime entity.
 *
 * Format: {prefix}_{ulid}
 * Example: signal_01ARZ3NDEKTSV4RRFFQ69G5FAV
 *
 * This is the ONLY function that should be used to create IDs for
 * persisted runtime objects. It guarantees:
 *   - No collisions across restarts (timestamp + crypto random)
 *   - No counters or in-memory state
 *   - No database round-trips
 *   - Lexicographic sortability within the same prefix
 *   - Readable prefix for debugging
 */
export function uniqueId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
