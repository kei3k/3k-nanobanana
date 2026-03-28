// =============================================================================
// 3K Nanobana — Database Helper
// =============================================================================
// SQLite3 database initialization and query helpers
// =============================================================================

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;

/**
 * Initialize the SQLite database
 * Creates the database file and runs schema if needed
 */
function initDatabase(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    
    // Enable WAL mode for better concurrent read performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Run schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    
    console.log('[DB] Database initialized at:', dbPath);
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
