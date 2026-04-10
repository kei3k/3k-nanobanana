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
const fal = require('../services/fal');
const sseManager = require('../api/sse');

const router = express.Router();

// Helper to translate Gemini API errors to Vietnamese
function translateError(error) {
    let msg = error.message || String(error);
    let code = error.status || 500;
    
    // Sometimes Google SDK wraps the real error message
    if (error.response && error.response.error && error.response.error.message) {
        msg = error.response.error.message;
    }

    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        return { 
            status: 429, 
            message: '⚠️ Máy chủ Nano Banana đang bị nghẽn mặt hoặc hết lượt tạo (Quota Exceeded). Anh thử click vào tên Model ở góc trái, đổi sang "Nano Banana 2 (Flash)" rồi gửi lại nhé!' 
        };
    }
    if (msg.includes('permission_denied') || msg.includes('API key not valid')) {
        return { 
            status: 401, 
            message: '🔐 API Key không đúng hoặc không có quyền truy cập. Anh kiểm tra lại API Key ở phần ⚙️ Cài đặt nhé!' 
        };
    }
    if (msg.includes('thought_signature')) {
        return { 
            status: 400, 
            message: '🛠️ Lỗi cấu trúc "Tư duy" của Google. Vui lòng thử lại bằng câu lệnh khác hoặc tạo 1 nhánh mới để tiếp tục.' 
        };
    }
    if (msg.includes('INVALID_ARGUMENT') || msg.includes('size')) {
         return {
            status: 400,
            message: '📐 Yêu cầu hoặc tham số hệ thống không hợp lệ (ví dụ: Google không hỗ trợ size này). Anh vui lòng thử tạo lại.'
         };
    }
    if (msg.includes('safety') || msg.includes('policy')) {
        return {
            status: 400,
            message: '🛡️ Lỗi vi phạm chính sách an toàn của Google (Safety Filters). Hãy đổi từ khóa khác nhé!'
        };
    }
    
    return { status: code, message: `Lỗi hệ thống: ${msg}` };
}

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
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
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

// ─── Fetch URL Proxy ───────────────────────────────────────────────────────
router.post('/fetch-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        
        // Return as base64 so frontend can handle it exactly like a file drop
        const base64 = buffer.toString('base64');
        res.json({
            success: true,
            mimeType,
            base64,
            dataUrl: `data:${mimeType};base64,${base64}`
        });

    } catch (error) {
        res.status(500).json({ error: `Failed to fetch URL: ${error.message}` });
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
                path: `/api/images/originals/${path.basename(savedImage.path)}`,
                thumbnailPath: savedImage.thumbnailPath 
                    ? `/api/images/thumbnails/${path.basename(savedImage.thumbnailPath)}`
                    : null,
            },
        });
    } catch (error) {
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
    }
});

// Send a chat message to edit the current image
router.post('/sessions/:id/chat', upload.array('referenceImages', 14), async (req, res) => {
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
            apiKey,
        };

        let result;

        // Build reference images from uploaded files
        const refImages = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                refImages.push({
                    data: file.buffer.toString('base64'),
                    mimeType: file.mimetype,
                });
            }
            console.log(`[Chat] ${refImages.length} reference image(s) attached`);
        }

        if (parentVersion && parentVersion.image_path) {
            // ─── v2.2: Direct Edit from Parent Image (NO multi-turn history) ───
            // Each edit is an independent API call on the parent version's image.
            // This prevents prompt degradation, pixel quality loss, and "returning
            // old images" after 5-6 edits. The user can branch from any version
            // to create divergent edit paths.
            const sourceImage = await imageProcessor.readImageAsBase64(parentVersion.image_path);

            console.log(`[Chat] Direct edit from V${parentVersion.version_number} (no history) | Prompt: "${prompt.substring(0, 60)}..."`);

            // Combine source image with reference images
            const allImages = [
                { data: sourceImage.base64, mimeType: sourceImage.mimeType },
                ...refImages,
            ];

            if (allImages.length > 1) {
                // Multiple images: source + references
                result = await gemini.editWithReferences(
                    allImages,
                    enhancedPrompt,
                    genParams
                );
            } else {
                // Single image: basic edit
                result = await gemini.editImage(
                    sourceImage.base64,
                    sourceImage.mimeType,
                    enhancedPrompt,
                    genParams
                );
            }
        } else {
            // Text-to-image (no parent version) — can still use reference images
            if (refImages.length > 0) {
                result = await gemini.editWithReferences(
                    refImages,
                    enhancedPrompt,
                    genParams
                );
            } else {
                result = await gemini.generateImage(enhancedPrompt, genParams);
            }
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
        
        const trans = translateError(error);

        // Store error message
        session.addMessage({
            sessionId: req.params.id,
            role: 'assistant',
            contentType: 'text',
            content: `Error: ${trans.message}`,
            metadata: { error: true },
        });

        res.status(trans.status).json({ success: false, error: trans.message });
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
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
    }
});

// Upscale a version to 4K
router.post('/sessions/:id/upscale/:versionId', async (req, res) => {
    try {
        const session = sessions.get(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        const version = session.getVersion(req.params.versionId);
        if (!version) return res.status(404).json({ error: 'Version not found' });

        const sourceImage = await imageProcessor.readImageAsBase64(version.image_path);

        const fal = require('../services/fal');
        const result = await fal.upscaleImage(sourceImage.base64, 4);

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
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
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
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
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
        const { prompt, model, aspectRatio, imageSize } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
        
        const apiKey = req.headers['x-api-key'];

        const result = await gemini.generateImage(prompt, {
            model: model || 'pro',
            aspectRatio, imageSize, apiKey
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
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
    }
});

// ─── Image Serving ───────────────────────────────────────────────────────────

router.get('/images/:subfolder/:filename', (req, res) => {
    const imageDir = path.resolve(process.env.IMAGE_DIR || './data/images');
    const filePath = path.join(
        imageDir,
        req.params.subfolder,
        req.params.filename
    );

    // Security: prevent path traversal
    if (!filePath.startsWith(imageDir)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
        console.warn(`[Image 404] File not found: ${filePath}`);
        return res.status(404).json({ error: 'Image not found', path: filePath });
    }

    // Determine correct content type
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
});

// Debug endpoint to check image storage
router.get('/debug/images', (req, res) => {
    const imageDir = path.resolve(process.env.IMAGE_DIR || './data/images');
    const subfolders = ['originals', 'generated', 'thumbnails', 'exports'];
    const result = { imageDir, subfolders: {} };
    for (const sub of subfolders) {
        const dir = path.join(imageDir, sub);
        if (fs.existsSync(dir)) {
            result.subfolders[sub] = fs.readdirSync(dir).length + ' files';
        } else {
            result.subfolders[sub] = 'MISSING';
        }
    }
    res.json(result);
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
        const trans = translateError(error);
        res.status(trans.status).json({ success: false, error: trans.message });
    }
});

// ─── Outfit Components (Modular Outfit System) ──────────────────────────────

const db = require('../db/database');

// List components (optionally filter by slot)
router.get('/components', (req, res) => {
    try {
        const { slot, limit } = req.query;
        const components = db.findComponentsBySlot(slot || null, parseInt(limit) || 50);
        res.json({ components });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a new component
router.post('/components', upload.single('referenceImage'), async (req, res) => {
    try {
        const { slot, name, description, tags, style } = req.body;

        if (!slot || !name) {
            return res.status(400).json({ error: 'Slot and name are required' });
        }

        const validSlots = ['head', 'face', 'top', 'bottom', 'footwear'];
        if (!validSlots.includes(slot)) {
            return res.status(400).json({ error: `Invalid slot. Must be one of: ${validSlots.join(', ')}` });
        }

        let referenceImagePath = null;
        let thumbnailPath = null;

        if (req.file) {
            const saved = await imageProcessor.saveUploadedFile(
                req.file.buffer, req.file.originalname, req.file.mimetype
            );
            referenceImagePath = saved.path;
            thumbnailPath = saved.thumbnailPath;
        }

        const component = db.insertComponent({
            slot,
            name,
            description: description || '',
            reference_image_path: referenceImagePath,
            thumbnail_path: thumbnailPath,
            tags: tags ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : '[]',
            style: style || 'freefire_3d',
        });

        res.json({ success: true, component });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a component
router.delete('/components/:id', (req, res) => {
    try {
        db.deleteById('outfit_components', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── Visual Asset Conversion ──────────────────────────────────────────────────

// Convert uploaded reference to FF 3D Style Asset
router.post('/assets/convert', upload.single('image'), async (req, res) => {
    try {
        const { slot, name, category, model } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Image is required' });
        
        const apiKey = req.headers['x-api-key'];
        
        // 1. Save original to read base64
        const savedOriginal = await imageProcessor.saveUploadedFile(
            req.file.buffer, req.file.originalname, req.file.mimetype
        );
        const sourceImage = await imageProcessor.readImageAsBase64(savedOriginal.path);
        
        // 2. Generate Prompt for extraction
        let prompt = promptEngine.FF_STYLE_CONSISTENCY_PROMPT;
        prompt += `\n\n[ISOLATION TASK]\nIsolate the ${slot || 'item'} from the image. Put it on a clean, solid white background. Remove all other context, people, and backgrounds.`;
        
        // 3. Ask Gemini to convert
        const result = await gemini.editImage(
            sourceImage.base64,
            sourceImage.mimeType,
            prompt,
            { model: model || 'pro', apiKey }
        );
        
        if (!result.imageBase64) {
            return res.status(500).json({ error: 'Failed to convert asset image' });
        }
        
        // 4. Save generated asset
        const savedAsset = await imageProcessor.saveBase64Image(result.imageBase64);
        
        // 5. Register to DB
        const component = db.insertComponent({
            slot: slot || category || 'top',
            name: name || `Asset ${Date.now()}`,
            description: 'Converted Asset',
            reference_image_path: savedAsset.path,
            thumbnail_path: savedAsset.thumbnailPath,
            tags: '["converted"]',
            style: 'freefire_3d',
        });
        
        res.json({ success: true, component, imagePath: `/api/images/generated/${savedAsset.filename}` });
    } catch (error) {
        console.error('[Asset Convert Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// List assemblies
router.get('/assemblies', (req, res) => {
    try {
        const assemblies = db.listAssemblies(parseInt(req.query.limit) || 50);
        res.json({ assemblies });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create an assembly
router.post('/assemblies', async (req, res) => {
    try {
        const { name, description, is_one_piece, head_component_id, face_component_id,
                top_component_id, bottom_component_id, footwear_component_id } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Assembly name is required' });
        }

        const assembly = db.insertAssembly({
            name,
            description: description || '',
            is_one_piece: is_one_piece ? 1 : 0,
            head_component_id: head_component_id || null,
            face_component_id: face_component_id || null,
            top_component_id: top_component_id || null,
            bottom_component_id: bottom_component_id || null,
            footwear_component_id: footwear_component_id || null,
        });

        res.json({ success: true, assembly });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get assembly with full component details
router.get('/assemblies/:id', (req, res) => {
    try {
        const assembly = db.findAssembly(req.params.id);
        if (!assembly) return res.status(404).json({ error: 'Assembly not found' });
        res.json({ assembly });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── Utilities ──────────────────────────────────────────────────

// Remove background using offline AI model `@imgly/background-removal-node`
router.post('/utils/remove-bg', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Image is required' });

        let base64, mimeType;
        try {
            console.log('[RMBG] Processing image with local offline model...');
            
            // Try offline Model first
            const { removeBackground } = require('@imgly/background-removal-node');
            const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
            const imageBlob = await removeBackground(blob, {
                model: 'isnet_general_use'
            });

            const buffer = Buffer.from(await imageBlob.arrayBuffer());
            base64 = buffer.toString('base64');
            mimeType = imageBlob.type || 'image/png';
        } catch (localErr) {
            console.warn('[RMBG] Local WASM model failed, falling back to Fal.ai Birefnet...', localErr.message);
            
            // Fallback to Fal.ai Cloud
            const inputBase64 = req.file.buffer.toString('base64');
            const falResult = await fal.removeBackground(inputBase64, req.file.mimetype);
            base64 = falResult.imageBase64;
            mimeType = falResult.mimeType;
        }

        res.json({ success: true, imageBase64: base64, mimeType });
    } catch (error) {
        console.error('[RMBG] Error:', error && error.message ? error.message : 'Unknown WASM/RMBG error');
        res.status(500).json({ error: error && error.message ? error.message : 'Background removal failed' });
    }
});

module.exports = router;
