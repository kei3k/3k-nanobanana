// =============================================================================
// 3K Nanobana — Express Server Entry Point
// =============================================================================
// Professional Internal AI Image Editor
// Powered by Gemini Nano Banana Pro / Nano Banana 2
// =============================================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase, closeDatabase } = require('./src/db/database');
const { initGemini } = require('./src/services/gemini');
const { initQueue } = require('./src/services/queue');
const { ensureDirectories } = require('./src/services/image-processor');
const apiRoutes = require('./src/api/routes');

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║        🍌 3K NANOBANA — Image Editor         ║');
    console.log('  ║        Powered by Gemini Nano Banana         ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');

    // 1. Initialize database
    const dbPath = process.env.DB_PATH || './data/nanobana.db';
    initDatabase(dbPath);

    // 2. Initialize Gemini AI client
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        console.warn('');
        console.warn('  ⚠️  WARNING: GEMINI_API_KEY is not set!');
        console.warn('  ⚠️  Set it in the .env file to enable AI features.');
        console.warn('  ⚠️  Get your key at: https://aistudio.google.com/apikey');
        console.warn('');
    } else {
        initGemini(apiKey);
    }

    // 3. Initialize processing queue
    const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '3');
    await initQueue(concurrency);

    // 4. Ensure image directories exist
    ensureDirectories();

    // 5. Create Express app
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ extended: true, limit: '100mb' }));

    // Serve static frontend files
    app.use(express.static(path.join(__dirname, 'public')));

    // API routes
    app.use('/api', apiRoutes);

    // SPA fallback — serve index.html for all non-API routes
    app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Start listening
    app.listen(PORT, HOST, () => {
        console.log(`  🚀 Server running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
        console.log(`  📁 Image storage: ${path.resolve(process.env.IMAGE_DIR || './data/images')}`);
        console.log(`  🗄️  Database: ${path.resolve(dbPath)}`);
        console.log(`  ⚡ Queue concurrency: ${concurrency}`);
        console.log('');
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n  🛑 Shutting down...');
        closeDatabase();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        closeDatabase();
        process.exit(0);
    });
}

startServer().catch(err => {
    console.error('Fatal error starting server:', err);
    process.exit(1);
});
