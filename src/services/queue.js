// =============================================================================
// 3K Nanobana — Queue Manager
// =============================================================================
// Async processing queue with p-queue for batch operations
// Supports: priority scheduling, retry, SSE progress, batch grouping
// =============================================================================

const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const sseManager = require('../api/sse');

let PQueue;
let queue;

/**
 * Initialize the processing queue
 */
async function initQueue(concurrency = 3) {
    // p-queue is ESM-only, so we dynamic import
    const mod = await import('p-queue');
    PQueue = mod.default;
    
    queue = new PQueue({ concurrency });
    
    // Queue event handlers
    queue.on('active', () => {
        console.log(`[Queue] Active: ${queue.pending} pending, ${queue.size} queued`);
    });

    queue.on('idle', () => {
        console.log('[Queue] All tasks complete');
        sseManager.broadcast({ type: 'queue:idle' });
    });

    console.log(`[Queue] Initialized with concurrency: ${concurrency}`);
    return queue;
}

/**
 * Add a single task to the queue
 * @param {Object} task - Task configuration
 * @param {Function} processFn - Async function to execute
 * @returns {Object} Queue item record
 */
async function addTask(task, processFn) {
    const id = uuidv4();
    const maxRetries = parseInt(process.env.MAX_RETRIES || '2');
    
    // Store in database
    db.insert('queue_items', {
        id,
        batch_id: task.batchId || null,
        session_id: task.sessionId || null,
        version_id: task.versionId || null,
        prompt: task.prompt,
        status: 'pending',
        priority: task.priority || 0,
        source_image_path: task.sourceImagePath || null,
        config_json: JSON.stringify(task.config || {}),
    });

    // Broadcast status
    sseManager.broadcast({
        type: 'queue:item:added',
        data: { id, batchId: task.batchId, status: 'pending' },
    });

    // Add to p-queue
    queue.add(async () => {
        await executeTask(id, processFn, maxRetries);
    }, { priority: task.priority || 0 });

    return db.findById('queue_items', id);
}

/**
 * Execute a task with retry logic
 */
async function executeTask(itemId, processFn, maxRetries) {
    const item = db.findById('queue_items', itemId);
    if (!item || item.status === 'cancelled') return;

    // Mark as processing
    db.update('queue_items', itemId, {
        status: 'processing',
        started_at: new Date().toISOString(),
    });

    sseManager.broadcast({
        type: 'queue:item:processing',
        data: { id: itemId, batchId: item.batch_id },
    });

    try {
        const result = await processFn(item);

        // Mark as completed
        db.update('queue_items', itemId, {
            status: 'completed',
            result_image_path: result?.imagePath || null,
            completed_at: new Date().toISOString(),
        });

        // Update batch counters
        if (item.batch_id) updateBatchProgress(item.batch_id);

        sseManager.broadcast({
            type: 'queue:item:completed',
            data: {
                id: itemId,
                batchId: item.batch_id,
                imagePath: result?.imagePath,
            },
        });

    } catch (error) {
        const retryCount = (item.retry_count || 0) + 1;
        console.error(`[Queue] Task ${itemId} failed (attempt ${retryCount}):`, error.message);

        // DON'T retry 429/Quota errors — they are already handled by gemini.withRetry()
        // Queue retrying 429s causes multiplicative request explosion
        const isQuotaError = error.message && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota'));

        if (retryCount <= maxRetries && !isQuotaError) {
            // Retry (only for non-quota transient errors)
            db.update('queue_items', itemId, {
                status: 'pending',
                retry_count: retryCount,
                error: error.message,
            });

            sseManager.broadcast({
                type: 'queue:item:retry',
                data: { id: itemId, batchId: item.batch_id, attempt: retryCount },
            });

            // Re-add to queue
            queue.add(async () => {
                await executeTask(itemId, processFn, maxRetries);
            });

        } else {
            // Final failure (or quota error — don't retry)
            db.update('queue_items', itemId, {
                status: 'failed',
                retry_count: retryCount,
                error: error.message,
                completed_at: new Date().toISOString(),
            });

            if (item.batch_id) updateBatchProgress(item.batch_id);

            sseManager.broadcast({
                type: 'queue:item:failed',
                data: { id: itemId, batchId: item.batch_id, error: error.message },
            });
        }
    }
}

// ─── Batch Operations ────────────────────────────────────────────────────────

/**
 * Create a batch job
 */
function createBatch({ name, prompt, config = {}, totalCount }) {
    const id = uuidv4();
    db.insert('batch_jobs', {
        id,
        name: name || `Batch ${new Date().toLocaleString()}`,
        status: 'pending',
        prompt,
        config_json: JSON.stringify(config),
        total_count: totalCount,
    });

    sseManager.broadcast({
        type: 'batch:created',
        data: { id, name, totalCount },
    });

    return db.findById('batch_jobs', id);
}

/**
 * Update batch progress counters
 */
function updateBatchProgress(batchId) {
    const batch = db.findById('batch_jobs', batchId);
    if (!batch) return;

    const items = db.findAll('queue_items', { batch_id: batchId }, 'created_at ASC', 10000);
    const completed = items.filter(i => i.status === 'completed').length;
    const failed = items.filter(i => i.status === 'failed').length;
    const total = items.length;

    const isFinished = (completed + failed) >= total;

    db.update('batch_jobs', batchId, {
        completed_count: completed,
        failed_count: failed,
        status: isFinished 
            ? (failed > 0 && completed === 0 ? 'failed' : 'completed')
            : 'processing',
        started_at: batch.started_at || new Date().toISOString(),
        completed_at: isFinished ? new Date().toISOString() : null,
    });

    sseManager.broadcast({
        type: 'batch:progress',
        data: { id: batchId, completed, failed, total, isFinished },
    });
}

/**
 * List batch jobs
 */
function listBatches(limit = 50) {
    return db.findAll('batch_jobs', {}, 'created_at DESC', limit);
}

/**
 * Get batch job with all items
 */
function getBatch(id) {
    const batch = db.findById('batch_jobs', id);
    if (!batch) return null;
    
    batch.config = safeParseJSON(batch.config_json);
    batch.items = db.findAll('queue_items', { batch_id: id }, 'created_at ASC', 10000);
    return batch;
}

/**
 * Get queue stats
 */
function getQueueStats() {
    const d = db.getDb();
    return {
        pending: d.prepare("SELECT COUNT(*) as c FROM queue_items WHERE status = 'pending'").get().c,
        processing: d.prepare("SELECT COUNT(*) as c FROM queue_items WHERE status = 'processing'").get().c,
        completed: d.prepare("SELECT COUNT(*) as c FROM queue_items WHERE status = 'completed'").get().c,
        failed: d.prepare("SELECT COUNT(*) as c FROM queue_items WHERE status = 'failed'").get().c,
        queueSize: queue ? queue.size : 0,
        queuePending: queue ? queue.pending : 0,
    };
}

function safeParseJSON(str) {
    try { return JSON.parse(str || '{}'); }
    catch { return {}; }
}

module.exports = {
    initQueue,
    addTask,
    createBatch,
    listBatches,
    getBatch,
    getQueueStats,
    updateBatchProgress,
};
