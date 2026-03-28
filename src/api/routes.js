// =============================================================================
// 3K Nanobana — API Routes
// =============================================================================
// All REST API endpoints for the image editor
// =============================================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const gemini = require('../services/gemini');
const session = require('../services/session');
const queueManager = require('../services/queue');
const promptEngine = require('../services/prompt-engine');
const imageProcessor = require('../services/image-processor');
const sseManager = require('../api/sse');

const router = express.Router();

// Multer config for file uploads (100MB max per file, up to 100 files)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 100 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/tiff'];
        cb(null, allowed.includes(file.mimetype));
    },
});

// ─── SSE Endpoint ────────────────────────────────────────────────────────────

router.get('/queue/stream', (req, res) => {
    sseManager.addClient(res);
});

// ─── Model Info ──────────────────────────────────────────────────────────────

router.get('/models', (req, res) => {
    res.json({
        models: gemini.MODELS,
        default: process.env.DEFAULT_MODEL || 'pro',
    });
});

// ─── Session Endpoints ───────────────────────────────────────────────────────

// Create a new session
router.post('/sessions', (req, res) => {
    try {
        const { name, model, config } = req.body;
        const sess = session.createSession({
            name,
            model: model || process.env.DEFAULT_MODEL || 'pro',
            config,
        });
        res.json({ success: true, session: sess });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List all sessions
router.get('/sessions', (req, res) => {
    try {
        const sessions = session.listSessions(parseInt(req.query.limit) || 50);
        res.json({ sessions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get session with version tree
router.get('/sessions/:id', (req, res) => {
    try {
        const sess = session.getSession(req.params.id);
        if (!sess) return res.status(404).json({ error: 'Session not found' });
        
        const messages = session.getMessages(req.params.id);
        res.json({ session: sess, messages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session
router.delete('/sessions/:id', (req, res) => {
    try {
        session.deleteSession(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── Chat / Edit Endpoints ───────────────────────────────────────────────────

// Upload image to start a session
router.post('/sessions/:id/upload', upload.single('image'), async (req, res) => {
    try {
        const sess = session.getSession(req.params.id);
        if (!sess) return res.status(404).json({ error: 'Session not found' });

        // Save uploaded image
        const savedImage = await imageProcessor.saveUploadedFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
        );

        // Create root version (V0 — original)
        const version = session.createVersion({
            sessionId: req.params.id,
            prompt: 'Original Upload',
            imagePath: savedImage.path,
            thumbnailPath: savedImage.thumbnailPath,
            width: savedImage.width,
            height: savedImage.height,
            fileSize: savedImage.fileSize,
        });

        // Store upload message
        session.addMessage({
            sessionId: req.params.id,
            role: 'user',
            contentType: 'image',
            content: `Uploaded: ${req.file.originalname}`,
            imagePath: savedImage.path,
            versionId: version.id,
        });

        res.json({
            success: true,
            version,
            image: {
                width: savedImage.width,
                height: savedImage.height,
                path: `/api/images/${path.basename(savedImage.path)}`,
                thumbnailPath: savedImage.thumbnailPath 
                    ? `/api/images/thumbnails/${path.basename(savedImage.thumbnailPath)}`
                    : null,
            },
        });
    } catch (error) {
        console.error('[Upload Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// Send a chat message to edit the current image
router.post('/sessions/:id/chat', upload.single('image'), async (req, res) => {
    try {
        const sess = session.getSession(req.params.id);
        if (!sess) return res.status(404).json({ error: 'Session not found' });

        const {
            prompt,
            parentVersionId,
            model,
            aspectRatio,
            imageSize,
            thinkingLevel,
            denoisingStrength,
            seed,
            identityLock,
            texturePreservation,
            mask, // { x, y, width, height, imageWidth, imageHeight }
        } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        // Determine parent version (latest or specified)
        let parentVersion = null;
        if (parentVersionId) {
            parentVersion = session.getVersion(parentVersionId);
        } else if (sess.versions && sess.versions.length > 0) {
            parentVersion = sess.versions[sess.versions.length - 1];
        }

        // Build enhanced prompt with all parameters
        const enhancedPrompt = promptEngine.buildEnhancedPrompt(prompt, {
            denoisingStrength: denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.5,
            seed: seed !== undefined && seed !== '' ? parseInt(seed) : null,
            identityLock: identityLock === true || identityLock === 'true',
            texturePreservation: texturePreservation === true || texturePreservation === 'true',
            mask: mask ? (typeof mask === 'string' ? JSON.parse(mask) : mask) : null,
        });

        // Store user message
        session.addMessage({
            sessionId: req.params.id,
            role: 'user',
            contentType: 'text',
            content: prompt,
        });

        // Determine generation parameters
        const apiKey = req.headers['x-api-key'];
        const genParams = {
            model: model || sess.model || 'pro',
            aspectRatio: aspectRatio || '1:1',
            imageSize: imageSize || '1K',
            thinkingLevel: thinkingLevel || undefined,
            apiKey,
        };

        let result;

        if (parentVersion && parentVersion.image_path) {
            // Image-to-image editing
            const sourceImage = await imageProcessor.readImageAsBase64(parentVersion.image_path);
            
            // Build chat history for context
            const history = session.buildChatHistory(req.params.id, parentVersion.id);
            
            // Load images referenced in history
            const loadedHistory = [];
            for (const msg of history) {
                const newParts = [];
                for (const part of msg.parts) {
                    if (part._imagePath) {
                        // Load and encode the referenced image
                        try {
                            const imgData = await imageProcessor.readImageAsBase64(part._imagePath);
                            newParts.push({
                                inlineData: {
                                    mimeType: imgData.mimeType,
                                    data: imgData.base64,
                                },
                            });
                        } catch (e) {
                            console.warn(`[Chat] Could not load image: ${part._imagePath}`);
                        }
                    } else {
                        newParts.push(part);
                    }
                }
                loadedHistory.push({ role: msg.role, parts: newParts });
            }

            // Use chatEdit with full history for multi-turn context
            if (loadedHistory.length > 0) {
                result = await gemini.chatEdit(
                    loadedHistory,
                    enhancedPrompt,
                    [{ data: sourceImage.base64, mimeType: sourceImage.mimeType }],
                    genParams
                );
            } else {
                result = await gemini.editImage(
                    sourceImage.base64,
                    sourceImage.mimeType,
                    enhancedPrompt,
                    genParams
                );
            }
        } else {
            // Text-to-image (no parent version)
            result = await gemini.generateImage(enhancedPrompt, genParams);
        }

        if (!result.imageBase64) {
            // Model returned text only, no image
            session.addMessage({
                sessionId: req.params.id,
                role: 'assistant',
                contentType: 'text',
                content: result.text || 'No image was generated. Please try a different prompt.',
            });
            return res.json({
                success: true,
                text: result.text,
                image: null,
            });
        }

        // Save generated image
        const savedImage = await imageProcessor.saveBase64Image(result.imageBase64);

        // Create new version
        const newVersion = session.createVersion({
            sessionId: req.params.id,
            parentId: parentVersion?.id || null,
            prompt,
            imagePath: savedImage.path,
            thumbnailPath: savedImage.thumbnailPath,
            width: savedImage.width,
            height: savedImage.height,
            fileSize: savedImage.fileSize,
            config: genParams,
        });

        // Store assistant message
        session.addMessage({
            sessionId: req.params.id,
            role: 'assistant',
            contentType: 'mixed',
            content: result.text || '',
            imagePath: savedImage.path,
            versionId: newVersion.id,
        });

        res.json({
            success: true,
            text: result.text,
            version: newVersion,
            image: {
                width: savedImage.width,
                height: savedImage.height,
                path: `/api/images/generated/${savedImage.filename}`,
                thumbnailPath: savedImage.thumbnailPath
                    ? `/api/images/thumbnails/${path.basename(savedImage.thumbnailPath)}`
                    : null,
            },
        });

    } catch (error) {
        console.error('[Chat Error]', error);
        
        // Store error message
        session.addMessage({
            sessionId: req.params.id,
            role: 'assistant',
            contentType: 'text',
            content: `Error: ${error.message}`,
            metadata: { error: true },
        });

        res.status(500).json({ error: error.message });
    }
});

// Branch from a specific version
router.post('/sessions/:id/branch/:versionId', (req, res) => {
    try {
        const { branchName } = req.body;
        const version = session.getVersion(req.params.versionId);
        if (!version) return res.status(404).json({ error: 'Version not found' });

        // The branch is implicit in the DAG — the next edit from this version
        // creates a new branch. We just return the version info for the UI to use.
        res.json({
            success: true,
            branchPoint: version,
            message: `Ready to branch from V${version.version_number}. Send your next edit.`,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upscale a version to 4K
router.post('/sessions/:id/upscale/:versionId', async (req, res) => {
    try {
        const version = session.getVersion(req.params.versionId);
        if (!version) return res.status(404).json({ error: 'Version not found' });

        const sourceImage = await imageProcessor.readImageAsBase64(version.image_path);
        const upscalePrompt = promptEngine.buildUpscalePrompt();
        const apiKey = req.headers['x-api-key'];

        const result = await gemini.editImage(
            sourceImage.base64,
            sourceImage.mimeType,
            upscalePrompt,
            {
                model: 'pro',
                imageSize: '4K',
                aspectRatio: req.body.aspectRatio || undefined,
                apiKey,
            }
        );

        if (!result.imageBase64) {
            return res.status(500).json({ error: 'Upscale failed — no image returned' });
        }

        const savedImage = await imageProcessor.saveBase64Image(result.imageBase64);

        const upscaledVersion = session.createVersion({
            sessionId: req.params.id,
            parentId: version.id,
            prompt: '⬆️ Upscaled to 4K',
            imagePath: savedImage.path,
            thumbnailPath: savedImage.thumbnailPath,
            width: savedImage.width,
            height: savedImage.height,
            fileSize: savedImage.fileSize,
            config: { imageSize: '4K', action: 'upscale' },
        });

        res.json({
            success: true,
            version: upscaledVersion,
            image: {
                width: savedImage.width,
                height: savedImage.height,
                path: `/api/images/generated/${savedImage.filename}`,
            },
        });
    } catch (error) {
        console.error('[Upscale Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── Batch Processing ────────────────────────────────────────────────────────

// Create batch job with multiple images
router.post('/batch', upload.array('images', 100), async (req, res) => {
    try {
        const { prompt, model, aspectRatio, imageSize, denoisingStrength, seed,
                identityLock, texturePreservation } = req.body;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images uploaded' });
        }
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Create batch job
        const apiKey = req.headers['x-api-key'];
        const batch = queueManager.createBatch({
            name: `Batch: ${prompt.substring(0, 50)}...`,
            prompt,
            config: { model, aspectRatio, imageSize, apiKey },
            totalCount: req.files.length,
        });

        // Enhanced prompt
        const enhancedPrompt = promptEngine.buildEnhancedPrompt(prompt, {
            denoisingStrength: denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.5,
            seed: seed ? parseInt(seed) : null,
            identityLock: identityLock === 'true',
            texturePreservation: texturePreservation === 'true',
        });

        // Queue each image
        for (const file of req.files) {
            const savedImage = await imageProcessor.saveUploadedFile(
                file.buffer, file.originalname, file.mimetype
            );

            await queueManager.addTask(
                {
                    batchId: batch.id,
                    prompt: enhancedPrompt,
                    sourceImagePath: savedImage.path,
                    config: { model, aspectRatio, imageSize, apiKey },
                },
                async (item) => {
                    const sourceImage = await imageProcessor.readImageAsBase64(item.source_image_path);
                    const config = JSON.parse(item.config_json || '{}');
                    
                    const result = await gemini.editImage(
                        sourceImage.base64,
                        sourceImage.mimeType,
                        item.prompt,
                        {
                            model: config.model || 'pro',
                            aspectRatio: config.aspectRatio,
                            imageSize: config.imageSize || '1K',
                            apiKey: config.apiKey,
                        }
                    );

                    if (!result.imageBase64) {
                        throw new Error('No image returned from API');
                    }

                    const saved = await imageProcessor.saveBase64Image(result.imageBase64);
                    return { imagePath: saved.path };
                }
            );
        }

        res.json({
            success: true,
            batch: {
                id: batch.id,
                name: batch.name,
                totalCount: req.files.length,
                status: 'processing',
            },
        });
    } catch (error) {
        console.error('[Batch Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// List batch jobs
router.get('/batch', (req, res) => {
    try {
        const batches = queueManager.listBatches();
        res.json({ batches });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get batch job details
router.get('/batch/:id', (req, res) => {
    try {
        const batch = queueManager.getBatch(req.params.id);
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        res.json({ batch });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Queue stats
router.get('/queue/stats', (req, res) => {
    try {
        const stats = queueManager.getQueueStats();
        res.json({ stats, sseClients: sseManager.getClientCount() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── Text-to-Image (No Session) ─────────────────────────────────────────────

router.post('/generate', async (req, res) => {
    try {
        const { prompt, model, aspectRatio, imageSize, thinkingLevel } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
        
        const apiKey = req.headers['x-api-key'];

        const result = await gemini.generateImage(prompt, {
            model: model || 'pro',
            aspectRatio, imageSize, thinkingLevel, apiKey
        });

        if (!result.imageBase64) {
            return res.json({ success: true, text: result.text, image: null });
        }

        const savedImage = await imageProcessor.saveBase64Image(result.imageBase64);

        res.json({
            success: true,
            text: result.text,
            image: {
                path: `/api/images/generated/${savedImage.filename}`,
                width: savedImage.width,
                height: savedImage.height,
            },
        });
    } catch (error) {
        console.error('[Generate Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── Image Serving ───────────────────────────────────────────────────────────

router.get('/images/:subfolder/:filename', (req, res) => {
    const filePath = path.join(
        process.env.IMAGE_DIR || './data/images',
        req.params.subfolder,
        req.params.filename
    );
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
    }
    res.sendFile(path.resolve(filePath));
});

// Export image in specific format
router.post('/export', async (req, res) => {
    try {
        const { imagePath, format, width, height } = req.body;
        const fullPath = path.resolve(imagePath);
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Source image not found' });
        }

        const exported = await imageProcessor.exportImage(fullPath, format || 'png', { width, height });
        res.download(exported.path, exported.filename);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
