import pg, { Pool } from 'pg';
import { trackQuery } from './queryTracker';

// Ensure BIGINT (OID 20) is always returned as a plain string so it survives
// JSON serialization without precision loss or BigInt serialization errors.
pg.types.setTypeParser(20, (val: string) => val);

let pool: Pool | null = null;

export async function getConnection() {
    if (pool) return pool;

    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            application_name: 'docklet',
        });
    } else {
        pool = new Pool({
            user: process.env.PGUSER || process.env.DB_USER || 'postgres',
            host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
            database: process.env.PGDATABASE || process.env.DATABASE || 'postgres',
            password: process.env.PGPASSWORD || process.env.PASSWORD || 'postgres',
            port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
            application_name: 'docklet',
        });
    }

    return pool;
}

/**
 * Destroy the current pool and force a fresh reconnect on the next query.
 * Call this after resuming a paused database so stale/dead connections are cleared.
 */
export async function resetPool(): Promise<void> {
    if (pool) {
        try { await pool.end(); } catch { /* ignore */ }
        pool = null;
    }
}

/**
 * Run a query against a system database (not the app database).
 * Required for ALTER DATABASE commands — PostgreSQL forbids modifying the
 * database you are currently connected to.
 * Tries "postgres" first, falls back to "template1" which is always present.
 */
export async function executeSysQuery(query: string, params: any[] = []) {
    // template1 is guaranteed to exist in every PostgreSQL installation
    const sysDbCandidates = ['template1', 'postgres'];

    const baseConfig = process.env.DATABASE_URL
        ? null
        : {
            user: process.env.PGUSER || process.env.DB_USER || 'postgres',
            host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
            password: process.env.PGPASSWORD || process.env.PASSWORD || 'postgres',
            port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
            application_name: 'docklet',
            max: 1,
        };

    let lastError: any;

    for (const sysDb of sysDbCandidates) {
        let sysPool: Pool;

        if (process.env.DATABASE_URL) {
            const url = new URL(process.env.DATABASE_URL);
            url.pathname = `/${sysDb}`;
            sysPool = new Pool({
                connectionString: url.toString(),
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                application_name: 'docklet',
                max: 1,
            });
        } else {
            sysPool = new Pool({ ...baseConfig, database: sysDb });
        }

        try {
            const result = await sysPool.query(query, params);
            await sysPool.end();
            return { rows: result.rows, fields: result.fields, rowCount: result.rowCount };
        } catch (err: any) {
            await sysPool.end().catch(() => {});
            // Detect "database does not exist" by both SQLSTATE code and message text
            const msg = (err.message || '').toLowerCase();
            const isNotFound =
                err.code === '3D000' ||
                msg.includes('does not exist') ||
                msg.includes('no such database') ||
                msg.includes('invalid catalog');
            if (isNotFound) { lastError = err; continue; }
            throw err;
        }
    }

    throw lastError;
}

export async function executeQuery(query: string, params: any[] = []) {
    const p = await getConnection();
    const start = Date.now();
    trackQuery(query);
    try {
        const result = await p.query(query, params);
        const duration = Date.now() - start;
        return {
            rows: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            duration,
        };
    } catch (error: any) {
        console.error('Database Query Error:', {
            query,
            params,
            errorMessage: error.message,
            detail: error.detail
        });
        throw {
            message: error.message,
            detail: error.detail,
            position: error.position,
            duration: Date.now() - start,
        };
    }
}
