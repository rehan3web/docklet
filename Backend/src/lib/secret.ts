// Load .env *before* reading process.env. Other modules (route handlers,
// middleware) statically import from this file, and ESM/CJS resolves all
// imports before the entry point's `dotenv.config()` runs — so without this,
// a .env-only deployment would fatally fail to find JWT_SECRET even when it
// is correctly set in .env.
import dotenv from 'dotenv';
dotenv.config();

/**
 * Loads and validates the JWT_SECRET environment variable.
 *
 * The JWT secret is the foundation of *all* server security:
 *   - It signs and verifies REST API JWTs.
 *   - It signs and verifies the Socket.IO handshake token.
 *   - It seeds the AES-256-GCM key used to encrypt secrets at rest
 *     (see lib/crypto.ts).
 *
 * If this value is missing, weak, or left at a hardcoded default, every
 * downstream guarantee collapses (token forgery, auth bypass, decryption
 * of stored secrets). For that reason this loader fails *fast* at startup
 * rather than silently falling back to an insecure default.
 */

const HARDCODED_DEFAULTS = new Set([
    'your-super-secret-key-change-it',
    'your-super-secret-key',
    'change-me',
    'changeme',
    'secret',
]);

const MIN_SECRET_LENGTH = 16;

let cached: string | null = null;

export function getJwtSecret(): string {
    if (cached) return cached;
    const raw = process.env.JWT_SECRET;
    if (!raw || typeof raw !== 'string' || raw.length === 0) {
        throw new Error(
            '[FATAL] JWT_SECRET environment variable is not set. ' +
            'Refusing to start with no signing secret. ' +
            'Generate one with: `openssl rand -hex 32`'
        );
    }
    if (raw.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `[FATAL] JWT_SECRET is too short (${raw.length} chars, minimum ${MIN_SECRET_LENGTH}). ` +
            'Generate one with: `openssl rand -hex 32`'
        );
    }
    if (HARDCODED_DEFAULTS.has(raw)) {
        throw new Error(
            '[FATAL] JWT_SECRET is set to a known insecure default value. ' +
            'Refusing to start. Generate one with: `openssl rand -hex 32`'
        );
    }
    cached = raw;
    return raw;
}
