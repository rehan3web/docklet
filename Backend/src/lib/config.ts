import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

function resolveConfigPath(): string {
    const candidates = [
        '/config/postgres.yml',                              // Docker container mount
        path.resolve(process.cwd(), 'postgres.yml'),        // CWD (local dev)
        path.resolve(process.cwd(), '../postgres.yml'),     // One level up
        path.resolve(__dirname, '../../../postgres.yml'),   // Relative to dist/
        path.resolve(__dirname, '../../postgres.yml'),
        path.resolve(__dirname, '../postgres.yml'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return candidates[1];
}

/**
 * Load .env file variables into a map (does NOT mutate process.env).
 * Reads from /config/.env (Docker mount) or the project root .env.
 */
function loadDotEnv(): Record<string, string> {
    const candidates = [
        '/config/.env',
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '../.env'),
    ];
    for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        try {
            const lines = fs.readFileSync(p, 'utf8').split('\n');
            const map: Record<string, string> = {};
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eq = trimmed.indexOf('=');
                if (eq === -1) continue;
                const key = trimmed.slice(0, eq).trim();
                const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
                map[key] = val;
            }
            return map;
        } catch { /* ignore */ }
    }
    return {};
}

/**
 * Recursively resolve ${VAR} and ${VAR:-default} placeholders in a parsed YAML object.
 * Looks up values from process.env first, then the .env file map.
 */
function resolveEnvVars(obj: any, envMap: Record<string, string>): any {
    if (typeof obj === 'string') {
        return obj.replace(/\$\{([^}]+)\}/g, (_match, expr) => {
            const [varName, ...rest] = expr.split(':-');
            const defaultVal = rest.join(':-');
            return process.env[varName] ?? envMap[varName] ?? defaultVal ?? _match;
        });
    }
    if (Array.isArray(obj)) return obj.map(item => resolveEnvVars(item, envMap));
    if (obj !== null && typeof obj === 'object') {
        const resolved: any = {};
        for (const [k, v] of Object.entries(obj)) {
            resolved[k] = resolveEnvVars(v, envMap);
        }
        return resolved;
    }
    return obj;
}

let CONFIG_PATH = resolveConfigPath();

export interface PostgresConfig {
    postgres: {
        environment: {
            POSTGRES_PASSWORD: string;
            POSTGRES_DB: string;
            PGPORT: number;
            POSTGRES_PORT: number;
        };
        ports: string[];
    };
    studio: {
        environment: {
            POSTGRES_USER: string;
            POSTGRES_DB: string;
            POSTGRES_PASSWORD: string;
        };
    };
    meta: {
        environment: {
            PG_META_DB_USER: string;
            PG_META_DB_PASSWORD: string;
            PG_META_DB_NAME: string;
        };
    };
}

export function loadConfig(): any {
    try {
        const fileContents = fs.readFileSync(CONFIG_PATH, 'utf8');
        const raw = yaml.load(fileContents) as any;
        const envMap = loadDotEnv();
        return resolveEnvVars(raw, envMap);
    } catch (e) {
        console.error('Error loading postgres.yml:', e);
        return null;
    }
}

export function saveConfig(services: any) {
    try {
        const data = { name: 'custom-supabase', services };
        const yamlStr = yaml.dump(data);
        fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
        return true;
    } catch (e) {
        console.error('Error saving postgres.yml:', e);
        return false;
    }
}
