// =============================================================================
// 3K Nanobana — Session Manager
// =============================================================================
// Manages editing sessions: creation, version trees, message history,
// branching, and conversation replay for Gemini multi-turn editing
// =============================================================================

const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

/**
 * Create a new editing session
 */
function createSession({ name, model = 'pro', config = {} }) {
    const id = uuidv4();
    db.insert('sessions', {
        id,
        name: name || 'Untitled Session',
        model,
        config_json: JSON.stringify(config),
    });
    return db.findById('sessions', id);
}

/**
 * Get all sessions (most recent first)
 */
function listSessions(limit = 50) {
    return db.findAll('sessions', {}, 'updated_at DESC', limit);
}

/**
 * Get a session by ID with its full version tree
 */
function getSession(id) {
    const session = db.findById('sessions', id);
    if (!session) return null;

    // Parse config JSON
    session.config = safeParseJSON(session.config_json);

    // Get all versions for this session
    session.versions = db.findAll('versions', { session_id: id }, 'created_at ASC', 1000);
    session.versions.forEach(v => { v.config = safeParseJSON(v.config_json); });

    // Build version tree
    session.versionTree = buildVersionTree(session.versions);

    return session;
}

/**
 * Update session metadata
 */
function updateSession(id, data) {
    const updateData = { ...data, updated_at: new Date().toISOString() };
    if (data.config) updateData.config_json = JSON.stringify(data.config);
    delete updateData.config;
    db.update('sessions', id, updateData);
    return db.findById('sessions', id);
}

/**
 * Delete a session and all associated data
 */
function deleteSession(id) {
    db.deleteById('sessions', id);
}

// ─── Version Management ─────────────────────────────────────────────────────

/**
 * Create a new version (image generation result)
 */
function createVersion({
    sessionId, parentId = null, branchName = 'main',
    prompt, imagePath, thumbnailPath, width, height, fileSize, config = {},
}) {
    const id = uuidv4();
    
    // Calculate version number
    const siblings = db.getDb().prepare(
        'SELECT MAX(version_number) as max_v FROM versions WHERE session_id = ?'
    ).get(sessionId);
    const versionNumber = (siblings?.max_v || 0) + 1;

    db.insert('versions', {
        id,
        session_id: sessionId,
        parent_id: parentId,
        branch_name: branchName,
        version_number: versionNumber,
        prompt,
        image_path: imagePath,
        thumbnail_path: thumbnailPath,
        width, height, file_size: fileSize,
        config_json: JSON.stringify(config),
    });

    // Update session thumbnail to latest version
    db.update('sessions', sessionId, {
        thumbnail_path: thumbnailPath || imagePath,
        updated_at: new Date().toISOString(),
    });

    return db.findById('versions', id);
}

/**
 * Get a specific version by ID
 */
function getVersion(id) {
    const version = db.findById('versions', id);
    if (version) version.config = safeParseJSON(version.config_json);
    return version;
}

/**
 * Get version ancestry chain (from root to specified version)
 * Used to replay conversation history for Gemini chat
 */
function getVersionAncestry(versionId) {
    const ancestry = [];
    let current = db.findById('versions', versionId);
    
    while (current) {
        ancestry.unshift(current); // prepend
        current = current.parent_id 
            ? db.findById('versions', current.parent_id) 
            : null;
    }
    
    return ancestry;
}

/**
 * Build a tree structure from flat version list
 */
function buildVersionTree(versions) {
    const map = {};
    const roots = [];

    // Index all versions
    versions.forEach(v => {
        map[v.id] = { ...v, children: [] };
    });

    // Build parent-child relationships
    versions.forEach(v => {
        if (v.parent_id && map[v.parent_id]) {
            map[v.parent_id].children.push(map[v.id]);
        } else {
            roots.push(map[v.id]);
        }
    });

    return roots;
}

// ─── Message History ─────────────────────────────────────────────────────────

/**
 * Add a message to session history
 */
function addMessage({
    sessionId, role, contentType = 'text', content,
    imagePath, versionId, metadata = {},
}) {
    const id = uuidv4();
    db.insert('messages', {
        id,
        session_id: sessionId,
        role,
        content_type: contentType,
        content,
        image_path: imagePath,
        version_id: versionId,
        metadata_json: JSON.stringify(metadata),
    });
    return db.findById('messages', id);
}

/**
 * Get all messages for a session
 */
function getMessages(sessionId, limit = 500) {
    return db.findAll('messages', { session_id: sessionId }, 'created_at ASC', limit);
}

/**
 * Build Gemini chat history from messages along a version branch
 * Re-creates the conversation context needed for multi-turn editing
 * @param {string} sessionId 
 * @param {string} upToVersionId - Optional: build history up to this version
 * @returns {Array} Gemini-compatible conversation history
 */
function buildChatHistory(sessionId, upToVersionId = null) {
    let messages;
    
    if (upToVersionId) {
        // Get the ancestry chain for this version
        const ancestry = getVersionAncestry(upToVersionId);
        const versionIds = new Set(ancestry.map(v => v.id));
        
        // Get messages that belong to this branch
        const allMessages = getMessages(sessionId);
        messages = allMessages.filter(m => {
            // Include messages without version_id (initial ones)
            // or messages whose version_id is in the ancestry
            return !m.version_id || versionIds.has(m.version_id);
        });
    } else {
        messages = getMessages(sessionId);
    }

    // Convert to Gemini format
    const history = [];
    for (const msg of messages) {
        const parts = [];
        
        if (msg.content) {
            parts.push({ text: msg.content });
        }
        if (msg.image_path) {
            // We'll need to load and encode the image when actually sending
            // For now, mark it as a reference
            parts.push({ _imagePath: msg.image_path });
        }

        if (parts.length > 0) {
            history.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts,
            });
        }
    }

    return history;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseJSON(str) {
    try { return JSON.parse(str || '{}'); }
    catch { return {}; }
}

module.exports = {
    createSession,
    listSessions,
    getSession,
    updateSession,
    deleteSession,
    createVersion,
    getVersion,
    getVersionAncestry,
    buildVersionTree,
    addMessage,
    getMessages,
    buildChatHistory,
};
