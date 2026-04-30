import crypto from 'crypto';
import { getJwtSecret } from './secret';

/**
 * Symmetric AES-256-GCM encryption for at-rest secrets (e.g. NVIDIA API key).
 * The encryption key is derived from JWT_SECRET (already required for auth)
 * via SHA-256 so we don't introduce another env-var requirement.
 *
 * Stored format: base64( iv (12) || tag (16) || ciphertext )
 * Plaintext fallback: any value not matching the `enc:v1:` prefix is treated
 * as legacy plaintext for backward compatibility, then re-encrypted on next
 * write.
 */

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
    // Reuse the validated JWT_SECRET (fails fast if absent/weak/default)
    // so we never derive a key from insecure material.
    const seed = getJwtSecret();
    return crypto.createHash('sha256').update(`docklet-settings:${seed}`).digest();
}

export function encryptSecret(plaintext: string): string {
    if (typeof plaintext !== 'string') throw new Error('encryptSecret: plaintext must be a string');
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(stored: string): string {
    if (!stored.startsWith(PREFIX)) {
        // Legacy plaintext value — return as-is.
        return stored;
    }
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
}

export function isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
}
