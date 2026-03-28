-- =============================================================================
-- 3K Nanobana — SQLite Database Schema
-- =============================================================================
-- Version: 1.0
-- Database: SQLite3
-- Description: Complete schema for AI Image Editor sessions, versions, queue
-- =============================================================================

-- Sessions: Top-level editing workspace
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Untitled Session',
    thumbnail_path TEXT,
    model TEXT NOT NULL DEFAULT 'pro',        -- 'pro' = Nano Banana Pro, 'flash' = Nano Banana 2
    config_json TEXT DEFAULT '{}',            -- Session-level settings (aspect_ratio, resolution, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Versions: DAG structure for image version tree
-- Each version is a node; parent_id links form the tree/DAG
CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_id TEXT,                           -- NULL for root (original upload)
    branch_name TEXT DEFAULT 'main',
    version_number INTEGER NOT NULL DEFAULT 1,
    prompt TEXT,                              -- The edit instruction that produced this version
    image_path TEXT NOT NULL,                 -- Full-res image path
    thumbnail_path TEXT,                      -- Thumbnail for quick preview
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    config_json TEXT DEFAULT '{}',            -- Config used for this generation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES versions(id) ON DELETE SET NULL
);

-- Chat messages: Full conversation history per session
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'image', 'mixed'
    content TEXT,                              -- Text content
    image_path TEXT,                           -- Associated image path
    version_id TEXT,                           -- Link to version if this message produced one
    metadata_json TEXT DEFAULT '{}',           -- Extra metadata (tokens used, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE SET NULL
);

-- Batch jobs: Group of queue items for bulk processing
CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Batch Job',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    prompt TEXT,                              -- Shared prompt for all items
    config_json TEXT DEFAULT '{}',            -- Shared config for all items
    total_count INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME
);

-- Queue items: Individual processing tasks
CREATE TABLE IF NOT EXISTS queue_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT,                            -- NULL for single tasks
    session_id TEXT,
    version_id TEXT,                          -- Source version (for edits)
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    priority INTEGER DEFAULT 0,              -- Higher = processed first
    retry_count INTEGER DEFAULT 0,
    error TEXT,                               -- Error message if failed
    source_image_path TEXT,                   -- Input image path
    result_image_path TEXT,                   -- Output image path
    config_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (batch_id) REFERENCES batch_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_versions_session ON versions(session_id);
CREATE INDEX IF NOT EXISTS idx_versions_parent ON versions(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_batch ON queue_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_status ON queue_items(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
