import crypto from 'crypto';

/**
 * Hash a plaintext password with a random salt using scrypt (Node's built-in,
 * no extra dependency). Store both `hash` and `salt` on the user record.
 */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Verify a plaintext password against a stored hash/salt pair.
 * Uses a timing-safe comparison to avoid leaking timing information.
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const candidate = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(hash, 'hex');
    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

/**
 * Generate a readable one-time temporary password, e.g. "Falcon-4821".
 * Shown once to the HR/Management user who creates or resets an account,
 * so it needs to be easy to read aloud / type, not cryptographically dense.
 */
const TEMP_WORDS = [
  'Falcon', 'Harbor', 'Quartz', 'Summit', 'Ember', 'Cedar', 'Marlin', 'Onyx',
  'Ridge', 'Delta', 'Aspen', 'Cobalt', 'Willow', 'Granite', 'Meridian', 'Pioneer',
];

export function generateTempPassword(): string {
  const word = TEMP_WORDS[crypto.randomInt(0, TEMP_WORDS.length)];
  const digits = crypto.randomInt(1000, 9999);
  return `${word}-${digits}`;
}

/** Basic username normalization: lowercase, trim, no spaces. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '.');
}

export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null;
}
