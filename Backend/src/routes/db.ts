import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { executeQuery } from '../lib/db';
import { broadcastSchemaChange, broadcastTableUpdate } from '../index';
import { getThroughput } from '../lib/queryTracker';

const router = express.Router();

// Get db overview for dashboard
router.get('/overview', authenticateToken, async (_req, res) => {
    try {
        const sizeResult = await executeQuery(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as size_pretty
        `);
        const tablesResult = await executeQuery(`
            SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const connectionsResult = await executeQuery(`
            SELECT count(*) FROM pg_stat_activity WHERE state = 'active'
        `);
        res.json({
            activeConnections: parseInt(connectionsResult.rows[0].count),
            databaseSize: sizeResult.rows[0].size_pretty,
            tableCount: parseInt(tablesResult.rows[0].count),
        });
    } catch (err: any) {
        res.status(500).json(err);
    }
});

// Get throughput data
router.get('/throughput', authenticateToken, (_req, res) => {
    res.json({ dataPoints: getThroughput() });
});

// Get active query activity
router.get('/activity', authenticateToken, async (_req, res) => {
    try {
        const result = await executeQuery(`
            SELECT
                pid,
                state,
                query,
                query_start,
                now() - query_start AS duration,
                wait_event_type,
                wait_event
            FROM pg_stat_activity
            WHERE state IS NOT NULL
              AND query NOT ILIKE '%pg_stat_activity%'
            ORDER BY query_start DESC NULLS LAST
            LIMIT 20
        `);
        const activities = result.rows.map((row: any) => ({
            pid: row.pid,
            state: row.state,
            query: row.query,
            startedAt: row.query_start ? row.query_start.toISOString() : new Date().toISOString(),
            duration: row.duration
                ? formatDuration(row.duration)
                : '0ms',
            waitEvent: row.wait_event,
        }));
        res.json({ activities });
    } catch (err: any) {
        res.status(500).json(err);
    }
});

// Tables with row count and size
router.get('/tables-extended', authenticateToken, async (_req, res) => {
    try {
        const result = await executeQuery(`
            SELECT
                t.table_name AS "tableName",
                COALESCE(s.n_live_tup, 0) AS "rowCount",
                pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS "totalSize"
            FROM information_schema.tables t
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
            WHERE t.table_schema = 'public'
            ORDER BY t.table_name
        `);
        res.json({ tables: result.rows });
    } catch (err: any) {
        res.status(500).json(err);
    }
});

// Create table
router.post('/tables', authenticateToken, async (req, res) => {
    const { tableName, columns } = req.body;
    if (!tableName) return res.status(400).json({ message: 'Table name is required' });

    const columnDefs = (columns || []).map((col: any) => {
        if (!col.name || !col.type) return null;
        let def = `"${col.name}" ${col.type}`;
        const isPk = col.isPrimary || col.primaryKey;
        const defVal = col.defaultValue ?? col.default;
        if (isPk) {
            def += ' PRIMARY KEY';
        } else {
            if (col.notNull) def += ' NOT NULL';
            // Skip NULL/empty defaults — only apply real defaults
            if (defVal && defVal !== '' && defVal.toUpperCase() !== 'NULL') {
                def += ` DEFAULT ${defVal}`;
            }
        }
        return def;
    }).filter(Boolean);

    if (columnDefs.length === 0) columnDefs.push('id SERIAL PRIMARY KEY');
    const sql = `CREATE TABLE "${tableName}" (${columnDefs.join(', ')})`;
    try {
        await executeQuery(sql);
        broadcastSchemaChange();
        res.json({ message: 'Table created', tableName });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Rename table
router.patch('/tables/:name/rename', authenticateToken, async (req, res) => {
    const { newName } = req.body;
    const oldName = req.params.name;
    if (!newName) return res.status(400).json({ message: 'New name is required' });
    try {
        await executeQuery(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
        broadcastSchemaChange();
        res.json({ message: 'Table renamed', newName });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// List all tables
router.get('/tables', authenticateToken, async (_req, res) => {
    try {
        const result = await executeQuery(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        res.json(result.rows);
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Get table schema
router.get('/tables/:name', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    try {
        const columns = await executeQuery(`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, is_identity
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
        `, [name]);

        const constraints = await executeQuery(`
            SELECT
                tc.constraint_name, tc.table_name, kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                tc.constraint_type
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                LEFT JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
            WHERE tc.table_name = $1 AND tc.table_schema = 'public';
        `, [name]);

        res.json({
            columns: columns.rows,
            constraints: constraints.rows
        });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Get table data
router.get('/tables/:name/data', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    const { limit = 50, offset = 0, sortColumn, sortOrder = 'ASC' } = req.query;

    let query = `SELECT * FROM "${name}"`;
    if (sortColumn) {
        query += ` ORDER BY "${sortColumn}" ${sortOrder}`;
    } else {
        query += ` ORDER BY 1`;
    }
    query += ` LIMIT ${limit} OFFSET ${offset}`;

    try {
        const result = await executeQuery(query);
        const countResult = await executeQuery(`SELECT count(*) FROM "${name}"`);
        res.json({
            data: result.rows,
            totalCount: parseInt(countResult.rows[0].count),
            fields: result.fields
        });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Insert row
router.post('/tables/:name/rows', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    const row = req.body;

    const cleanedRow: any = {};
    Object.keys(row).forEach(key => {
        if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
            cleanedRow[key] = row[key];
        }
    });

    const columns = Object.keys(cleanedRow);
    const values = Object.values(cleanedRow);

    if (columns.length === 0) {
        try {
            const result = await executeQuery(`INSERT INTO "${name}" DEFAULT VALUES RETURNING *`);
            broadcastTableUpdate(name);
            return res.json(result.rows[0]);
        } catch (error: any) {
            return res.status(500).json(error);
        }
    }

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const query = `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;

    try {
        const result = await executeQuery(query, values);
        broadcastTableUpdate(name);
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Add column
router.post('/tables/:name/columns', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    const { columnName, dataType, defaultValue, isNullable } = req.body;

    if (!columnName || !dataType) {
        return res.status(400).json({ message: 'Column name and data type are required' });
    }

    let query = `ALTER TABLE "${name}" ADD COLUMN "${columnName}" ${dataType}`;
    if (defaultValue !== undefined && defaultValue !== '') {
        query += ` DEFAULT ${defaultValue}`;
    }
    if (!isNullable) {
        query += ` NOT NULL`;
    }

    try {
        await executeQuery(query);
        broadcastSchemaChange();
        res.json({ message: 'Column added successfully' });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Update row
router.patch('/tables/:name/rows', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    const { selection, updates } = req.body;

    const updateKeys = Object.keys(updates);
    const updateVals = Object.values(updates);
    const selectionKeys = Object.keys(selection);
    const selectionVals = Object.values(selection) as any[];

    const setClause = updateKeys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');

    // Build WHERE using IS NULL for null values (SQL: col = NULL is always false)
    const nonNullSelVals: any[] = [];
    let paramIdx = updateKeys.length + 1;
    const whereConditions = selectionKeys.map((key, i) => {
        const val = selectionVals[i];
        if (val === null || val === undefined) {
            return `"${key}" IS NULL`;
        }
        nonNullSelVals.push(val);
        return `"${key}" = $${paramIdx++}`;
    });

    const query = `UPDATE "${name}" SET ${setClause} WHERE ${whereConditions.join(' AND ')} RETURNING *`;
    const values = [...updateVals, ...nonNullSelVals];

    try {
        const result = await executeQuery(query, values);
        broadcastTableUpdate(name);
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Delete row
router.delete('/tables/:name/rows', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    const selection = req.body;
    const whereClause = Object.keys(selection).map((key, i) => `"${key}" = $${i + 1}`).join(' AND ');

    const query = `DELETE FROM "${name}" WHERE ${whereClause}`;

    try {
        await executeQuery(query, Object.values(selection));
        broadcastTableUpdate(name);
        res.json({ message: 'Row deleted' });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Delete table
router.delete('/tables/:name', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    try {
        await executeQuery(`DROP TABLE "${name}" CASCADE`);
        broadcastSchemaChange();
        res.json({ message: 'Table deleted' });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Duplicate table
router.post('/tables/:name/duplicate', authenticateToken, async (req, res) => {
    const name = req.params.name as string;
    const newName = `${name}_copy_${Date.now()}`;
    try {
        await executeQuery(`CREATE TABLE "${newName}" (LIKE "${name}" INCLUDING ALL)`);

        // LIKE...INCLUDING ALL does not carry over GENERATED AS IDENTITY.
        // Re-add identity for any identity columns from the source table.
        const identityCols = await executeQuery(`
            SELECT column_name, identity_generation
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND is_identity = 'YES'
        `, [name]);
        for (const col of identityCols.rows) {
            const gen = col.identity_generation === 'BY DEFAULT' ? 'BY DEFAULT' : 'ALWAYS';
            await executeQuery(`ALTER TABLE "${newName}" ALTER COLUMN "${col.column_name}" ADD GENERATED ${gen} AS IDENTITY`);
        }

        await executeQuery(`INSERT INTO "${newName}" SELECT * FROM "${name}"`);
        broadcastSchemaChange();
        res.json({ message: 'Table duplicated', newTableName: newName });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Get full schema for visualization
router.get('/schema', authenticateToken, async (_req, res) => {
    try {
        const columnsResult = await executeQuery(`
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `);

        const constraintsResult = await executeQuery(`
            SELECT
                tc.constraint_name, tc.table_name, kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                tc.constraint_type
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                LEFT JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
            WHERE tc.table_schema = 'public';
        `);

        const pkSet = new Set(
            constraintsResult.rows
                .filter((c: any) => c.constraint_type === 'PRIMARY KEY')
                .map((c: any) => `${c.table_name}.${c.column_name}`)
        );
        const fkSet = new Set(
            constraintsResult.rows
                .filter((c: any) => c.constraint_type === 'FOREIGN KEY')
                .map((c: any) => `${c.table_name}.${c.column_name}`)
        );

        const tablesMap: Record<string, any> = {};
        for (const col of columnsResult.rows) {
            if (!tablesMap[col.table_name]) {
                tablesMap[col.table_name] = { name: col.table_name, columns: [] };
            }
            tablesMap[col.table_name].columns.push({
                name: col.column_name,
                type: col.data_type,
                isPk: pkSet.has(`${col.table_name}.${col.column_name}`),
                isFk: fkSet.has(`${col.table_name}.${col.column_name}`),
            });
        }

        const relations = constraintsResult.rows
            .filter((c: any) => c.constraint_type === 'FOREIGN KEY')
            .map((c: any) => ({
                from: c.table_name,
                fromCol: c.column_name,
                to: c.foreign_table_name,
                toCol: c.foreign_column_name,
            }));

        res.json({
            tables: Object.values(tablesMap),
            relations,
            columns: columnsResult.rows,
            constraints: constraintsResult.rows,
        });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Get database stats
router.get('/stats', authenticateToken, async (_req, res) => {
    try {
        const tablesResult = await executeQuery(`
            SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const rowsResult = await executeQuery(`
            SELECT sum(n_live_tup) as total_rows FROM pg_stat_user_tables
        `);
        const sizeResult = await executeQuery(`
            SELECT pg_database_size(current_database()) as size_bytes,
                   pg_size_pretty(pg_database_size(current_database())) as size_pretty
        `);
        const connectionsResult = await executeQuery(`
            SELECT count(*) FROM pg_stat_activity
        `);
        const throughput = getThroughput();

        res.json({
            totalTables: parseInt(tablesResult.rows[0].count),
            totalRows: parseInt(rowsResult.rows[0].total_rows || '0'),
            dbSize: sizeResult.rows[0].size_pretty,
            dbSizeBytes: parseInt(sizeResult.rows[0].size_bytes),
            activeConnections: parseInt(connectionsResult.rows[0].count),
            throughput
        });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

// Delete column
router.delete('/tables/:name/columns/:column', authenticateToken, async (req, res) => {
    const { name, column } = req.params;
    try {
        await executeQuery(`ALTER TABLE "${name}" DROP COLUMN "${column}" CASCADE`);
        broadcastSchemaChange();
        res.json({ message: 'Column dropped' });
    } catch (error: any) {
        res.status(500).json(error);
    }
});

function formatDuration(interval: any): string {
    if (!interval) return '0ms';
    const totalMs = Math.abs(
        (interval.hours || 0) * 3600000 +
        (interval.minutes || 0) * 60000 +
        (interval.seconds || 0) * 1000 +
        (interval.milliseconds || 0)
    );
    if (totalMs < 1000) return `${Math.round(totalMs)}ms`;
    if (totalMs < 60000) return `${(totalMs / 1000).toFixed(1)}s`;
    return `${Math.floor(totalMs / 60000)}m ${Math.round((totalMs % 60000) / 1000)}s`;
}

export default router;
