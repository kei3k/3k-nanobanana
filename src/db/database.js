// =============================================================================
// 3K FreeFire Studio — Database Helper (Pure JS — No Native Compilation)
// =============================================================================
// Uses sql.js (WebAssembly SQLite) instead of better-sqlite3
// Compatible API: db.prepare(sql).run/get/all() works the same
// =============================================================================

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
let dbPath = null;
let saveTimer = null;

/**
 * Statement wrapper — mimics better-sqlite3's prepare() API
 */
class StatementWrapper {
    constructor(database, sql) {
        this._db = database;
        this._sql = sql;
    }

    _sanitizeParams(params) {
        // sql.js throws if a parameter is undefined. Map undefined to null.
        return params.map(p => (p === undefined ? null : p));
    }

    run(...params) {
        this._db.run(this._sql, this._sanitizeParams(params));
        scheduleSave();
        return { changes: this._db.getRowsModified() };
    }

    get(...params) {
        try {
            const stmt = this._db.prepare(this._sql);
            if (params.length > 0) stmt.bind(this._sanitizeParams(params));
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                return row;
            }
            stmt.free();
            return undefined;
        } catch (e) {
            // Return undefined for no results
            return undefined;
        }
    }

    all(...params) {
        const results = [];
        try {
            const stmt = this._db.prepare(this._sql);
            if (params.length > 0) stmt.bind(this._sanitizeParams(params));
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
        } catch (e) {
            // Return empty array on error
        }
        return results;
    }
}

/**
 * Database wrapper — mimics better-sqlite3's Database API
 */
class DatabaseWrapper {
    constructor(sqlDb) {
        this._db = sqlDb;
    }

    prepare(sql) {
        return new StatementWrapper(this._db, sql);
    }

    exec(sql) {
        this._db.exec(sql);
        scheduleSave();
    }

    pragma(pragmaStr) {
        try {
            this._db.exec(`PRAGMA ${pragmaStr}`);
        } catch (e) {
            // Some pragmas may not be supported in sql.js, ignore
        }
    }

    close() {
        flushSave();
        this._db.close();
    }

    getRowsModified() {
        return this._db.getRowsModified();
    }
}

/**
 * Schedule a debounced save to disk (every 1 second max)
 */
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        flushSave();
    }, 1000);
}

/**
 * Immediately save database to disk
 */
function flushSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (db && dbPath) {
        try {
            const data = db._db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        } catch (e) {
            console.error('[DB] Save error:', e.message);
        }
    }
}

/**
 * Initialize the SQLite database (async — uses sql.js WASM)
 */
async function initDatabase(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    dbPath = filePath;

    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        const sqlDb = new SQL.Database(fileBuffer);
        db = new DatabaseWrapper(sqlDb);
    } else {
        const sqlDb = new SQL.Database();
        db = new DatabaseWrapper(sqlDb);
    }

    // Enable WAL mode and foreign keys
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);

    // Save initial state
    flushSave();

    // Auto-save periodically
    setInterval(() => flushSave(), 5000);

    console.log('[DB] Database initialized at:', filePath);
    return db;
}

/**
 * Get the database instance
 */
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

/**
 * Close the database connection
 */
function closeDatabase() {
    if (db) {
        flushSave();
        db.close();
        db = null;
        console.log('[DB] Database connection closed');
    }
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Insert a row and return the inserted data
 */
function insert(table, data) {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map(k => {
        const v = data[k];
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    });

    const stmt = getDb().prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    );
    stmt.run(...values);
    return data;
}

/**
 * Find a single row by ID
 */
function findById(table, id) {
    return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

/**
 * Find rows with optional conditions
 */
function findAll(table, where = {}, orderBy = 'created_at DESC', limit = 100) {
    const keys = Object.keys(where);
    let query = `SELECT * FROM ${table}`;

    if (keys.length > 0) {
        const conditions = keys.map(k => `${k} = ?`).join(' AND ');
        query += ` WHERE ${conditions}`;
    }

    query += ` ORDER BY ${orderBy} LIMIT ${limit}`;

    const values = keys.map(k => where[k]);
    return getDb().prepare(query).all(...values);
}

/**
 * Update a row by ID
 */
function update(table, id, data) {
    const keys = Object.keys(data);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => {
        const v = data[k];
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    });
    values.push(id);

    getDb().prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values);
}

/**
 * Delete a row by ID
 */
function deleteById(table, id) {
    getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,
    insert,
    findById,
    findAll,
    update,
    deleteById,
};
