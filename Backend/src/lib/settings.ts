import { getConnection } from './db';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto';

let initialized = false;

/**
 * Keys whose values must always be encrypted at rest. Values written to these
 * keys are AES-GCM encrypted before persistence; values read are decrypted
 * transparently. Plaintext legacy rows are migrated on next read.
 */
const SECRET_KEYS = new Set<string>(['nvidia_api_key']);

async function ensureTable() {
    if (initialized) return;
    const pool = await getConnection();
    // Migrate old table name if it exists and the new one does not yet
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nextbase_settings')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'docklet_settings')
            THEN
                ALTER TABLE nextbase_settings RENAME TO docklet_settings;
            END IF;
        END
        $$;
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS docklet_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    initialized = true;
}

export async function getSetting(key: string): Promise<string | null> {
    await ensureTable();
    const pool = await getConnection();
    const r = await pool.query('SELECT value FROM docklet_settings WHERE key = $1', [key]);
    const raw: string | undefined = r.rows[0]?.value;
    if (raw == null) return null;
    if (SECRET_KEYS.has(key)) {
        try {
            const decrypted = decryptSecret(raw);
            // Lazy-migrate legacy plaintext values to encrypted form.
            if (!isEncrypted(raw)) {
                await pool.query(
                    `UPDATE docklet_settings SET value = $1, updated_at = NOW() WHERE key = $2`,
                    [encryptSecret(decrypted), key]
                );
            }
            return decrypted;
        } catch (err) {
            console.error(`Failed to decrypt setting ${key}:`, (err as Error).message);
            return null;
        }
    }
    return raw;
}

export async function setSetting(key: string, value: string): Promise<void> {
    await ensureTable();
    const pool = await getConnection();
    const stored = SECRET_KEYS.has(key) ? encryptSecret(value) : value;
    await pool.query(
        `INSERT INTO docklet_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, stored]
    );
}

export async function deleteSetting(key: string): Promise<void> {
    await ensureTable();
    const pool = await getConnection();
    await pool.query('DELETE FROM docklet_settings WHERE key = $1', [key]);
}
