// =============================================================================
// 3K FreeFire Studio — Workflow API
// =============================================================================
// REST endpoints for node-based workflow execution
// Processes workflow graphs from the frontend node editor
// =============================================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const gemini = require('../services/gemini');
const fal = require('../services/fal');
const promptEngine = require('../services/prompt-engine');
const imageProcessor = require('../services/image-processor');

const router = express.Router();

// Multer for workflow image uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        cb(null, allowed.includes(file.mimetype));
    },
});

// ─── Execute Workflow ────────────────────────────────────────────────────────

/**
 * Execute a complete workflow from the node editor
 * 
 * Request body:
 * {
 *   workflow: { nodes: [...], connections: [...] },
 *   images: { nodeId: base64data, ... }    // Attached images per node
 * }
 */
router.post('/execute', upload.array('images', 20), async (req, res) => {
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { workflow } = body;
        
        if (!workflow || !workflow.nodes) {
            return res.status(400).json({ error: 'Workflow data is required' });
        }

        const apiKey = req.headers['x-api-key'];
        
        // Parse the workflow graph
        const executionPlan = compileWorkflow(workflow);
        
        // Collect uploaded images by field name/index
        const uploadedImages = {};
        if (req.files) {
            for (const file of req.files) {
                const nodeId = file.fieldname; // e.g., 'node_123'
                uploadedImages[nodeId] = {
                    data: file.buffer.toString('base64'),
                    mimeType: file.mimetype,
                };
            }
        }
        
        // Also check for base64 images in body
        if (body.imageData) {
            for (const [nodeId, imgData] of Object.entries(body.imageData)) {
                uploadedImages[nodeId] = {
                    data: imgData.data || imgData,
                    mimeType: imgData.mimeType || 'image/png',
                };
            }
        }

        // Execute the workflow steps in order
        const results = {};
        let finalImage = null;
        let finalImages = []; // For multi-view
        let finalText = '';

        for (const step of executionPlan) {
            // Inject prompt overrides from Flow Editor into each step's config
            if (body.promptOverrides && step.config) {
                step.config._promptOverrides = body.promptOverrides;
            }

            const stepResult = await executeWorkflowStep(
                step,
                results,
                uploadedImages,
                apiKey
            );
            results[step.nodeId] = stepResult;

            if (step.type === 'output' || step.type === 'OutputNode' || step.isTerminal) {
                // Check for multi-view output
                if (stepResult.multiViewImages && stepResult.multiViewImages.length > 0) {
                    finalImages = stepResult.multiViewImages;
                    finalImage = stepResult.imageBase64; // The stitched strip
                    finalText = stepResult.text || '';
                } else {
                    finalImage = stepResult.imageBase64;
                    finalText = stepResult.text || '';
                }
            }
        }

        // Handle multi-view output
        if (finalImages.length > 0) {
            const savedImages = [];
            for (const viewImg of finalImages) {
                const saved = await imageProcessor.saveBase64Image(viewImg.imageBase64);
                savedImages.push({
                    path: `/api/images/generated/${saved.filename}`,
                    width: saved.width,
                    height: saved.height,
                    perspective: viewImg.perspective,
                });
            }
            
            // Also save the stitched strip so Visual Mode can download it
            let stitchedPath = null;
            if (finalImage) {
                const savedStrip = await imageProcessor.saveBase64Image(finalImage);
                stitchedPath = `/api/images/generated/${savedStrip.filename}`;
            }

            return res.json({
                success: true,
                text: finalText,
                image: stitchedPath ? { path: stitchedPath } : null,
                images: savedImages,
                multiView: true,
                stepResults: Object.keys(results).length,
            });
        }

        // Save the final output image (single view)
        if (finalImage) {
            const savedImage = await imageProcessor.saveBase64Image(finalImage);
            return res.json({
                success: true,
                text: finalText,
                image: {
                    path: `/api/images/generated/${savedImage.filename}`,
                    width: savedImage.width,
                    height: savedImage.height,
                },
                stepResults: Object.keys(results).length,
            });
        }

        res.json({
            success: true,
            text: finalText || 'Workflow completed but no image was generated.',
            image: null,
        });

    } catch (error) {
        console.error('[Workflow Execute Error]', error);
        res.status(500).json({
            success: false,
            error: `Lỗi thực thi workflow: ${error.message}`,
        });
    }
});

// ─── Execute Single Node ─────────────────────────────────────────────────────

router.post('/node/execute', upload.array('images', 5), async (req, res) => {
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { nodeConfig } = body;
        
        if (!nodeConfig) {
            return res.status(400).json({ error: 'Node configuration is required' });
        }

        const apiKey = req.headers['x-api-key'];
        
        // Collect images
        const images = [];
        if (req.files) {
            for (const file of req.files) {
                images.push({
                    data: file.buffer.toString('base64'),
                    mimeType: file.mimetype,
                });
            }
        }
        if (body.imageData) {
            const imgList = Array.isArray(body.imageData) ? body.imageData : [body.imageData];
            for (const img of imgList) {
                images.push({
                    data: img.data || img,
                    mimeType: img.mimeType || 'image/png',
                });
            }
        }

        // Build prompt from node config
        const prompt = promptEngine.buildWorkflowPrompt({
            ...nodeConfig,
            ffMode: nodeConfig.ffMode || false,
        });
        
        const genParams = {
            model: nodeConfig.model || 'pro',
            aspectRatio: nodeConfig.aspectRatio || '1:1',
            apiKey,
        };

        let result;
        if (images.length > 0) {
            result = await gemini.editWithReferences(images, prompt, genParams);
        } else {
            result = await gemini.generateImage(prompt, genParams);
        }

        if (result.imageBase64) {
            const savedImage = await imageProcessor.saveBase64Image(result.imageBase64);
            return res.json({
                success: true,
                text: result.text,
                image: {
                    path: `/api/images/generated/${savedImage.filename}`,
                    width: savedImage.width,
                    height: savedImage.height,
                },
            });
        }

        res.json({
            success: true,
            text: result.text || 'No image generated',
            image: null,
        });

    } catch (error) {
        console.error('[Node Execute Error]', error);
        res.status(500).json({
            success: false,
            error: `Lỗi thực thi node: ${error.message}`,
        });
    }
});

// ─── Get Preset Workflows ────────────────────────────────────────────────────

router.get('/presets', (req, res) => {
    res.json({
        presets: [
            {
                id: 'outfit_change',
                name: 'Đổi Trang Phục',
                nameEn: 'Outfit Change',
                description: 'Thay đổi trang phục cho nhân vật, giữ nguyên khuôn mặt',
                icon: '👗',
                nodes: ['image_input', 'face_reference', 'outfit_selector', 'output'],
            },
            {
                id: 'modular_outfit',
                name: 'Outfit Modular',
                nameEn: 'Modular Outfit',
                description: 'Tùy chỉnh từng bộ phận: Đầu, Mặt, Áo, Quần, Giày',
                icon: '🧩',
                nodes: ['image_input', 'face_reference', 'body_anatomy_mapper', 'component_selector', 'output'],
            },
            {
                id: 'pose_change',
                name: 'Đổi Pose',
                nameEn: 'Pose Change',
                description: 'Thay đổi tư thế của nhân vật',
                icon: '💃',
                nodes: ['image_input', 'face_reference', 'pose_selector', 'output'],
            },
            {
                id: 'style_transfer',
                name: 'Chuyển Style',
                nameEn: 'Style Transfer',
                description: 'Chuyển đổi phong cách: 3D, Realistic, Anime...',
                icon: '🎨',
                nodes: ['image_input', 'face_reference', 'style_selector', 'output'],
            },
            {
                id: 'full_restyle',
                name: 'Tùy Chỉnh Toàn Bộ',
                nameEn: 'Full Restyle',
                description: 'Đổi outfit + pose + style cùng lúc',
                icon: '🔥',
                nodes: ['image_input', 'face_reference', 'outfit_selector', 'pose_selector', 'style_selector', 'output'],
            },
        ],
        styleOptions: [
            { id: '3d_render', name: '3D Game Render', nameVi: 'Render 3D Game', icon: '🎮' },
            { id: 'realistic', name: 'Photorealistic', nameVi: 'Ảnh Thực Tế', icon: '📷' },
            { id: 'semi_realistic', name: 'Semi-Realistic', nameVi: 'Bán Thực Tế', icon: '🎬' },
            { id: 'anime', name: 'Anime Style', nameVi: 'Phong Cách Anime', icon: '🎌' },
        ],
        outfitSlots: promptEngine.OUTFIT_SLOTS,
    });
});

// ─── Save/Load Workflows ─────────────────────────────────────────────────────

const WORKFLOW_DIR = path.resolve(process.env.IMAGE_DIR || './data/images', '..', 'workflows');

router.post('/save', (req, res) => {
    try {
        const { name, workflow } = req.body;
        if (!name || !workflow) {
            return res.status(400).json({ error: 'Name and workflow data required' });
        }

        // Ensure workflow directory exists
        if (!fs.existsSync(WORKFLOW_DIR)) {
            fs.mkdirSync(WORKFLOW_DIR, { recursive: true });
        }

        const filename = `${name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
        const filepath = path.join(WORKFLOW_DIR, filename);
        
        fs.writeFileSync(filepath, JSON.stringify({
            name,
            workflow,
            createdAt: new Date().toISOString(),
        }, null, 2));

        res.json({ success: true, filename });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/saved', (req, res) => {
    try {
        if (!fs.existsSync(WORKFLOW_DIR)) {
            return res.json({ workflows: [] });
        }

        const files = fs.readdirSync(WORKFLOW_DIR).filter(f => f.endsWith('.json'));
        const workflows = files.map(f => {
            const data = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'));
            return { filename: f, ...data };
        });

        res.json({ workflows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Compile a node graph into an ordered execution plan
 * Performs topological sort of nodes based on connections
 */
function compileWorkflow(workflow) {
    const { nodes, connections } = workflow;
    if (!nodes || nodes.length === 0) return [];

    // Build adjacency map
    const nodeMap = {};
    const inDegree = {};
    
    for (const node of nodes) {
        nodeMap[node.id] = node;
        inDegree[node.id] = 0;
    }

    // Count in-degrees from connections
    if (connections) {
        for (const conn of connections) {
            if (inDegree[conn.targetId] !== undefined) {
                inDegree[conn.targetId]++;
            }
        }
    }

    // Topological sort (Kahn's algorithm)
    const queue = [];
    for (const id of Object.keys(inDegree)) {
        if (inDegree[id] === 0) queue.push(id);
    }

    const executionOrder = [];
    while (queue.length > 0) {
        const current = queue.shift();
        executionOrder.push(current);

        if (connections) {
            for (const conn of connections) {
                if (conn.sourceId === current) {
                    inDegree[conn.targetId]--;
                    if (inDegree[conn.targetId] === 0) {
                        queue.push(conn.targetId);
                    }
                }
            }
        }
    }

    // Build execution steps
    return executionOrder.map(nodeId => {
        const node = nodeMap[nodeId];
        return {
            nodeId,
            type: node.type,
            config: node.properties || node.config || {},
            inputs: (connections || [])
                .filter(c => c.targetId === nodeId)
                .map(c => ({ sourceId: c.sourceId, sourcePort: c.sourcePort, targetPort: c.targetPort })),
            isTerminal: !(connections || []).some(c => c.sourceId === nodeId),
        };
    });
}

/**
 * Execute a single workflow step
 */
async function executeWorkflowStep(step, previousResults, uploadedImages, apiKey) {
    const { type, config, inputs, nodeId } = step;

    switch (type) {
        case 'image_input':
        case 'ImageInput': {
            // Return the uploaded image for this node
            const img = uploadedImages[nodeId] || uploadedImages[`node_${nodeId}`];
            if (!img) {
                throw new Error(`No image provided for input node ${nodeId}`);
            }
            return { imageBase64: img.data, mimeType: img.mimeType, text: 'Image loaded' };
        }

        case 'face_reference':
        case 'FaceReference': {
            // Collect face reference images from inputs
            const faceImages = [];
            for (const input of inputs) {
                const prev = previousResults[input.sourceId];
                if (prev && prev.imageBase64) {
                    faceImages.push({ data: prev.imageBase64, mimeType: prev.mimeType || 'image/png' });
                }
            }
            // Also check for directly uploaded face images
            const directImg = uploadedImages[nodeId] || uploadedImages[`node_${nodeId}`];
            if (directImg) {
                faceImages.push(directImg);
            }
            return { faceImages, text: `${faceImages.length} face reference(s) loaded` };
        }

        // ─── NEW: Body Anatomy Mapper ────────────────────────────────────
        case 'body_anatomy_mapper':
        case 'BodyAnatomyMapper': {
            // Collect body reference image from inputs
            let bodyImage = null;
            for (const input of inputs) {
                const prev = previousResults[input.sourceId];
                if (prev && prev.imageBase64) {
                    bodyImage = { data: prev.imageBase64, mimeType: prev.mimeType || 'image/png' };
                    break;
                }
            }
            // Also check direct uploads
            const directBody = uploadedImages[nodeId] || uploadedImages[`node_${nodeId}`];
            if (directBody) bodyImage = directBody;

            return {
                anatomyData: {
                    bodyType: config.bodyType || 'standard',
                    poseSource: config.poseSource || 'from_input_image',
                    hasReference: !!bodyImage,
                },
                bodyImage,
                imageBase64: bodyImage ? bodyImage.data : null,
                mimeType: bodyImage ? bodyImage.mimeType : null,
                text: `Body anatomy mapped (${config.bodyType || 'standard'})`,
            };
        }

        // ─── NEW: Component Selector (Modular Outfit System) ─────────────
        case 'component_selector':
        case 'ComponentSelector': {
            return await executeModularOutfitNode(step, previousResults, uploadedImages, apiKey);
        }

        case 'outfit_selector':
        case 'OutfitSelector': {
            return await executeAINode(step, previousResults, uploadedImages, apiKey, {
                outfit: config.outfit || config.description || 'default outfit',
            });
        }

        case 'pose_selector':
        case 'PoseSelector': {
            // v2.2: Support pose reference image input
            const posePromptConfig = {
                pose: config.pose || config.description || 'standing pose',
            };
            // Check if a pose reference image is connected
            if (config.poseReferenceImage && config.poseReferenceImage.data) {
                posePromptConfig.pose = `Adopt the EXACT pose shown in the reference pose image. ${posePromptConfig.pose}`;
            }
            return await executeAINode(step, previousResults, uploadedImages, apiKey, posePromptConfig);
        }

        case 'style_selector':
        case 'StyleSelector': {
            return await executeAINode(step, previousResults, uploadedImages, apiKey, {
                style: config.style || '3d_render',
            });
        }

        case 'output':
        case 'OutputNode': {
            // Check for multi-view mode
            if (config.multiView) {
                return await executeMultiViewOutput(step, previousResults, uploadedImages, apiKey);
            }
            // Standard: Pass through the last input's result
            for (const input of inputs) {
                const prev = previousResults[input.sourceId];
                if (prev && prev.imageBase64) {
                    return prev;
                }
            }
            return { text: 'No input image for output', imageBase64: null };
        }

        default: {
            // Generic node — use custom prompt
            return await executeAINode(step, previousResults, uploadedImages, apiKey, {
                customPrompt: config.prompt || config.customPrompt || '',
            });
        }
    }
}

/**
 * Execute a Modular Outfit node (ComponentSelector)
 * Handles per-slot reference images and descriptions
 */
async function executeModularOutfitNode(step, previousResults, uploadedImages, apiKey) {
    const { inputs, nodeId, config } = step;

    // ═══ INCREMENTAL MODE DETECTION ═══
    const isIncrementalMode = config._incrementalMode === true;
    const incrementalSlot = config._incrementalSlot || null;

    if (isIncrementalMode && incrementalSlot) {
        console.log(`[Workflow] ⚡ INCREMENTAL MODE: Only adding slot "${incrementalSlot}"`);
    }

    // Collect inputs from connected nodes
    let faceRefCount = 0;
    const allSlotKeys = Object.keys(promptEngine.OUTFIT_SLOTS).filter(k => !promptEngine.OUTFIT_SLOTS[k]._legacy);
    const slotImages = { base: [], face_ref: [] };
    // Initialize array for all possible slots
    for (const k of Object.keys(promptEngine.OUTFIT_SLOTS)) {
        slotImages[k] = [];
    }
    let anatomyData = null;

    for (const input of inputs) {
        const prev = previousResults[input.sourceId];
        if (!prev) continue;

        if (prev.faceImages) {
            // Face reference node
            for (const fi of prev.faceImages) {
                slotImages.face_ref.push(fi);
                faceRefCount++;
            }
        } else if (prev.anatomyData) {
            // Body anatomy mapper node
            anatomyData = prev.anatomyData;
            if (prev.bodyImage) {
                slotImages.base.push(prev.bodyImage);
            }
        } else if (prev.imageBase64) {
            slotImages.base.push({ data: prev.imageBase64, mimeType: prev.mimeType || 'image/png' });
        }
    }

    // Build component data from node config — v3.0: all slot keys
    const slots = config._layerOrder && config._layerOrder.length > 0
        ? config._layerOrder
        : allSlotKeys;
    const components = {};

    for (const slot of slots) {
        const slotConfig = config[slot] || config[`${slot}Config`] || {};
        const isEnabled = slotConfig.enabled !== false && (slotConfig.description || slotConfig.refCount);

        if (isEnabled) {
            components[slot] = {
                description: slotConfig.description || '',
                refCount: slotConfig.refCount || 0,
            };

            // Collect per-slot reference images from uploaded images
            const slotImgKey = `${nodeId}_${slot}`;
            const slotImg = uploadedImages[slotImgKey] || uploadedImages[`node_${nodeId}_${slot}`];
            if (slotImg) {
                slotImages[slot].push(slotImg);
                components[slot].refCount = (components[slot].refCount || 0) + 1;
            }

            // Also check for inline base64 slot images
            if (slotConfig.referenceImage) {
                slotImages[slot].push({
                    data: slotConfig.referenceImage,
                    mimeType: slotConfig.referenceMimeType || 'image/png',
                });
                components[slot].refCount = (components[slot].refCount || 0) + 1;
            }
        }
    }

    // ═══ BUILD PROMPT ═══
    let prompt;
    
    if (isIncrementalMode && incrementalSlot && components[incrementalSlot]) {
        // ── INCREMENTAL: Single-slot prompt targeting only the new item ──
        const comp = components[incrementalSlot];
        prompt = promptEngine.buildIncrementalSlotPrompt(
            incrementalSlot,
            comp.description || '',
            comp.refCount || 0,
            {
                preserveFace: config.preserveFace !== false,
                ffMode: config.ffMode || false,
                promptOverrides: config._promptOverrides || {},
            }
        );
        console.log(`[Workflow] Incremental prompt for "${incrementalSlot}": ${prompt.substring(0, 120)}...`);
    } else {
        // ── FULL: Multi-slot prompt with all components ──
        prompt = promptEngine.buildModularOutfitPrompt(components, {
            preserveFace: config.preserveFace !== false,
            isOnePiece: config.isOnePiece || false,
            bodyType: anatomyData?.bodyType || config.bodyType || 'standard',
            style: config.style,
            denoisingStrength: config.denoisingStrength,
            faceRefCount,
            anatomyData,
            ffMode: config.ffMode || false,
            layerOrder: config._layerOrder || [],
            promptOverrides: config._promptOverrides || {},  // Flow Editor overrides
        });
    }

    const genParams = {
        model: config.model || 'pro',
        aspectRatio: config.aspectRatio || '1:1',
        apiKey,
    };

    // For incremental mode, only pass the base image + the new slot's reference
    if (isIncrementalMode && incrementalSlot) {
        const incrementalSlotImages = { base: slotImages.base };
        incrementalSlotImages[incrementalSlot] = slotImages[incrementalSlot] || [];
        
        let result;
        if (genParams.model.startsWith('fal-')) {
            result = await fal.editWithSlotReferences(incrementalSlotImages, prompt, genParams);
        } else {
            result = await gemini.editWithSlotReferences(incrementalSlotImages, prompt, genParams);
        }
        return {
            imageBase64: result.imageBase64,
            mimeType: result.mimeType,
            text: result.text,
        };
    }

    // Use slot-labeled references if we have slot-specific images
    const hasSlotImages = slots.some(s => slotImages[s].length > 0);

    let result;
    if (genParams.model.startsWith('fal-')) {
        result = await fal.editWithSlotReferences(slotImages, prompt, genParams);
    } else if (hasSlotImages || slotImages.base.length > 0 || slotImages.face_ref.length > 0) {
        result = await gemini.editWithSlotReferences(slotImages, prompt, genParams);
    } else {
        result = await gemini.generateImage(prompt, genParams);
    }

    return {
        imageBase64: result.imageBase64,
        mimeType: result.mimeType,
        text: result.text,
    };
}

/**
 * Execute multi-view output: generates Front, Back, Side perspectives
 * v2.2 Fix: First ensures we have a base image, then generates additional views from it
 */
async function executeMultiViewOutput(step, previousResults, uploadedImages, apiKey) {
    const { inputs, config } = step;

    // Find the input result (which may or may not have an image already generated)
    let sourceImage = null;

    for (const input of inputs) {
        const prev = previousResults[input.sourceId];
        if (prev && prev.imageBase64) {
            sourceImage = { data: prev.imageBase64, mimeType: prev.mimeType || 'image/png' };
            break;
        }
    }

    // v2.2 Fix: If we don't have a source image (upstream node was config-only),
    // search all previous results for any generated image
    if (!sourceImage) {
        console.log('[Multi-View] No source image from direct input. Searching all previous results...');
        
        for (const [nodeId, result] of Object.entries(previousResults)) {
            if (result && result.imageBase64) {
                sourceImage = { data: result.imageBase64, mimeType: result.mimeType || 'image/png' };
                console.log(`[Multi-View] Found source image from node ${nodeId}`);
                break;
            }
        }
        
        if (!sourceImage) {
            return { text: 'Multi-view failed: No source image available. Make sure the workflow generates an image before the output node.', imageBase64: null, multiViewImages: [] };
        }
    }

    const genParams = {
        model: config.model || 'pro',
        aspectRatio: config.aspectRatio || '1:1',
        apiKey,
    };

    const multiViewImages = [];

    // View 1 (Main Pose) = the existing source image
    multiViewImages.push({
        imageBase64: sourceImage.data,
        mimeType: sourceImage.mimeType || 'image/png',
        perspective: 'main',
        text: 'Main view (base image)',
    });

    // View 2 to 5: A-Pose Front, Back, Side Right, Side Left
    const additionalPerspectives = ['a_front', 'a_back', 'a_side_right', 'a_side_left'];

    for (const perspective of additionalPerspectives) {
        // v3.0: Strict styling constraints for multi-view generation
        const styleConstraint = config._promptOverrides?.FF_STYLE || promptEngine.FF_STYLE_CONSISTENCY_PROMPT || "";
        const basePrompt = `[BẮT BUỘC] Match the character's face, body, and EXACT outfit (colors, logos, materials) completely.
${styleConstraint}
- DO NOT CHANGE TO REALISTIC PHOTOGRAPHY. Keep the 3D Game Render style.
- Generate EXACTLY ONE image.`;

        const viewPrompt = promptEngine.buildMultiViewPrompt(basePrompt, perspective);

        try {
            console.log(`[Multi-View Phase 2] Generating ${perspective} view...`);
            const result = await gemini.editWithReferences(
                [sourceImage],
                viewPrompt,
                genParams
            );

            if (result.imageBase64) {
                multiViewImages.push({
                    imageBase64: result.imageBase64,
                    mimeType: result.mimeType,
                    perspective,
                    text: result.text,
                });
            }
        } catch (err) {
            console.error(`[Multi-View] Error generating ${perspective} view:`, err.message);
        }
    }

    // ─── Stitch 5 images into a horizontal strip (5120x1024) ───
    let finalStripBase64 = null;
    let finalStripMimeType = 'image/png';
    const singleWidth = 1024;
    const singleHeight = 1024;

    try {
        console.log(`[Multi-View] Stitching ${multiViewImages.length} images...`);
        // Resize all to 1024x1024 and get buffers
        const processedBuffers = await Promise.all(
            multiViewImages.map(async (img) => {
                const b = Buffer.from(img.imageBase64, 'base64');
                return await sharp(b).resize(singleWidth, singleHeight, { fit: 'cover' }).toBuffer();
            })
        );

        // Create composite array
        const compositeMap = processedBuffers.map((imgBuffer, index) => ({
            input: imgBuffer,
            top: 0,
            left: index * singleWidth
        }));

        const stripWidth = singleWidth * processedBuffers.length;
        const stripBuffer = await sharp({
            create: {
                width: stripWidth,
                height: singleHeight,
                channels: 4,
                background: { r: 128, g: 128, b: 128, alpha: 1 } // Gray background
            }
        })
        .composite(compositeMap)
        .png()
        .toBuffer();

        finalStripBase64 = stripBuffer.toString('base64');
    } catch (err) {
        console.error('[Multi-View] Error stitching images:', err);
    }

    return {
        imageBase64: finalStripBase64 || multiViewImages[0].imageBase64,
        mimeType: finalStripMimeType,
        text: `Generated ${multiViewImages.length}/5 perspectives strip`,
        multiViewImages,
    };
}

/**
 * Execute an AI-powered node (calls Gemini API)
 */
async function executeAINode(step, previousResults, uploadedImages, apiKey, promptConfig) {
    const { inputs, nodeId, config } = step;

    // Collect all input images
    const images = [];
    let faceRefCount = 0;

    for (const input of inputs) {
        const prev = previousResults[input.sourceId];
        if (!prev) continue;

        if (prev.faceImages) {
            // Face reference node
            for (const fi of prev.faceImages) {
                images.push(fi);
                faceRefCount++;
            }
        } else if (prev.imageBase64) {
            images.push({ data: prev.imageBase64, mimeType: prev.mimeType || 'image/png' });
        }
    }

    // Build prompt
    const prompt = promptEngine.buildWorkflowPrompt({
        ...promptConfig,
        preserveFace: config.preserveFace !== false,
        denoisingStrength: config.denoisingStrength,
        faceRefCount,
        model: config.model,
        ffMode: config.ffMode || false,
    });

    const genParams = {
        model: config.model || 'pro',
        aspectRatio: config.aspectRatio || '1:1',
        apiKey,
    };

    let result;
    if (images.length > 0) {
        result = await gemini.editWithReferences(images, prompt, genParams);
    } else {
        result = await gemini.generateImage(prompt, genParams);
    }

    return {
        imageBase64: result.imageBase64,
        mimeType: result.mimeType,
        text: result.text,
    };
}

// ─── Direct Image Upscaler ───────────────────────────────────────────────────
router.post('/upscale', express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        const apiKey = req.headers['x-api-key'];

        if (!imageBase64) {
            return res.status(400).json({ error: 'Missing imageBase64' });
        }

        const result = await gemini.upscaleImage(imageBase64, { apiKey });

        if (result.imageBase64) {
            const savedImage = await imageProcessor.saveBase64Image(result.imageBase64);
            return res.json({
                success: true,
                image: {
                    path: `/api/images/generated/${savedImage.filename}`,
                    width: savedImage.width,
                    height: savedImage.height,
                },
            });
        }

        res.json({ success: false, error: 'Upscale failed' });

    } catch (error) {
        console.error('[API] Upscale Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Lỗi xử lý Upscale',
        });
    }
});

// ─── Phase 2+: Composite Strip (for Flow Editor) ────────────────────────────
router.post('/composite-strip', express.json({ limit: '100mb' }), async (req, res) => {
    try {
        const { images, layout, tileSize } = req.body;
        if (!images || images.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        const size = parseInt(tileSize) || 1024;

        // Resize all images
        const buffers = await Promise.all(
            images.map(async (b64) => {
                const buf = Buffer.from(b64, 'base64');
                return await sharp(buf).resize(size, size, { fit: 'cover' }).toBuffer();
            })
        );

        let stripBuffer;
        if (layout === 'vertical') {
            const compositeMap = buffers.map((buf, i) => ({ input: buf, top: i * size, left: 0 }));
            stripBuffer = await sharp({ create: { width: size, height: size * buffers.length, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
                .composite(compositeMap).png().toBuffer();
        } else {
            // horizontal (default)
            const compositeMap = buffers.map((buf, i) => ({ input: buf, top: 0, left: i * size }));
            stripBuffer = await sharp({ create: { width: size * buffers.length, height: size, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
                .composite(compositeMap).png().toBuffer();
        }

        const savedImg = await imageProcessor.saveBase64Image(stripBuffer.toString('base64'));
        res.json({
            success: true,
            image: {
                path: `/api/images/generated/${savedImg.filename}`,
                imageBase64: stripBuffer.toString('base64'),
                width: savedImg.width,
                height: savedImg.height,
            },
        });
    } catch (error) {
        console.error('[Composite Strip Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── Phase 3: Element Extraction ─────────────────────────────────────────────

/**
 * Extract ALL equipped elements from a character image as separate 1024x1024 PNGs
 * POST /api/workflow/extract-elements
 * Body: { imageBase64, equippedSlots: ['top_inner','jacket',...], model }
 * Returns: { success, elements: [{ slot, imageBase64, name }] }
 */
router.post('/extract-elements', express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { imageBase64, equippedSlots, model } = req.body;
        const apiKey = req.headers['x-api-key'];

        if (!imageBase64) {
            return res.status(400).json({ error: 'Missing imageBase64' });
        }
        if (!equippedSlots || equippedSlots.length === 0) {
            return res.status(400).json({ error: 'No equipped slots to extract' });
        }

        console.log(`[Extract Elements] Starting extraction of ${equippedSlots.length} elements...`);

        const sourceImage = { data: imageBase64, mimeType: 'image/png' };
        const genParams = {
            model: model || 'pro',
            aspectRatio: '1:1',
            apiKey,
        };

        const elements = [];

        for (const slotKey of equippedSlots) {
            const slotDef = promptEngine.OUTFIT_SLOTS[slotKey];
            if (!slotDef || slotDef._legacy) continue;

            try {
                console.log(`[Extract] Extracting: ${slotKey} (${slotDef.nameVi})...`);

                const extractPrompt = promptEngine.buildElementExtractionPrompt(slotKey);

                const result = await gemini.editWithReferences(
                    [sourceImage],
                    extractPrompt,
                    genParams
                );

                if (result.imageBase64) {
                    // Post-process: resize to exact 1024x1024
                    const rawBuffer = Buffer.from(result.imageBase64, 'base64');
                    const processedBuffer = await sharp(rawBuffer)
                        .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .png()
                        .toBuffer();

                    const processedBase64 = processedBuffer.toString('base64');

                    // Save the extracted element
                    const savedImg = await imageProcessor.saveBase64Image(processedBase64);

                    elements.push({
                        slot: slotKey,
                        name: slotDef.nameVi,
                        icon: slotDef.icon,
                        imagePath: `/api/images/generated/${savedImg.filename}`,
                        imageBase64: processedBase64,
                    });

                    console.log(`[Extract] ✅ ${slotKey} extracted successfully`);
                }
            } catch (err) {
                console.error(`[Extract] ❌ Error extracting ${slotKey}:`, err.message);
            }
        }

        console.log(`[Extract] Done! ${elements.length}/${equippedSlots.length} elements extracted.`);

        res.json({
            success: true,
            elements,
            totalExtracted: elements.length,
            totalRequested: equippedSlots.length,
        });

    } catch (error) {
        console.error('[Extract Elements Error]', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Lỗi tách element',
        });
    }
});

// ─── CANVAS MODE UTILITIES ──────────────────────────────────────────────────

// Generate a single custom perspective for canvas building
router.post('/canvas/pose', async (req, res) => {
    try {
        const { sourceImage, perspective, promptOverrides, equippedState, modelId, flatLighting } = req.body;
        if (!sourceImage || !perspective) {
            return res.status(400).json({ error: 'Missing sourceImage or perspective' });
        }

        const apiKey = req.headers['x-api-key'];
        
        const styleConstraint = promptOverrides?.FF_STYLE || promptEngine.FF_STYLE_CONSISTENCY_PROMPT || "";
        const basePrompt = `[BẮT BUỘC] Match the character's face, body, and EXACT outfit (colors, logos, materials) completely.
${styleConstraint}
- DO NOT CHANGE TO REALISTIC PHOTOGRAPHY. Keep the 3D Game Render style.
- Generate EXACTLY ONE image.`;

        let viewPrompt = promptEngine.buildMultiViewPrompt(basePrompt, perspective);
        
        // If flatLighting is disabled, strip out the lighting constraint from the prompt
        if (flatLighting === false) {
            viewPrompt = viewPrompt.replace(/\[CRITICAL — UNIFORM FLAT LIGHTING\][\s\S]*?NOT from scene lighting\.`/g, '');
            // Also remove any remaining MULTI_VIEW_LIGHTING_CONSTRAINT remnants
            viewPrompt = viewPrompt.replace(/\[CRITICAL — UNIFORM FLAT LIGHTING\][\s\S]*?NOT from scene lighting\./g, '');
        }

        // Map equippedState to slotImages format
        const slotImages = { base: [sourceImage] };
        
        if (equippedState) {
            for (const [slotKey, slotData] of Object.entries(equippedState)) {
                if (!slotImages[slotKey]) slotImages[slotKey] = [];
                if (slotData && slotData.imageBase64) {
                    slotImages[slotKey].push({
                        data: slotData.imageBase64,
                        mimeType: slotData.mimeType || 'image/png'
                    });
                }
            }
        }

        console.log(`[Canvas Pose] Generating ${perspective} with modular references using model: ${modelId} | flatLighting: ${flatLighting !== false}...`);
        
        // Dynamic Provider Routing (Gemini vs Fal.ai) — no auto-fallback
        let result;
        const requestedModel = modelId || 'pro';
        if (requestedModel.startsWith('fal-')) {
            result = await fal.editWithSlotReferences(
                slotImages,
                viewPrompt,
                { model: requestedModel, apiKey }
            );
        } else {
            result = await gemini.editWithSlotReferences(
                slotImages,
                viewPrompt,
                { model: requestedModel, aspectRatio: '1:1', apiKey }
            );
        }

        if (!result.imageBase64) throw new Error('Generate failed');

        res.json({
            success: true,
            imageBase64: result.imageBase64,
            mimeType: result.mimeType,
        });

    } catch (error) {
        console.error('[Canvas Pose Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// Extract a specific clothing element
router.post('/canvas/extract', async (req, res) => {
    try {
        const { sourceImage, slot, perspective } = req.body;
        if (!sourceImage || !slot) {
            return res.status(400).json({ error: 'Missing sourceImage or slot' });
        }

        const apiKey = req.headers['x-api-key'];
        
        console.log(`[Canvas Extract] Extracting ${slot} at angle ${perspective || 'default'}...`);
        const prompt = promptEngine.buildElementExtractionPrompt(slot, '', perspective || 'default');

        const result = await gemini.editWithReferences(
            [sourceImage],
            prompt,
            { model: 'pro', aspectRatio: '1:1', apiKey }
        );

        if (!result.imageBase64) throw new Error('Extract failed');

        res.json({
            success: true,
            imageBase64: result.imageBase64,
            mimeType: result.mimeType,
        });

    } catch (error) {
        console.error('[Canvas Extract Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── HEAD EDITOR ENDPOINTS ────────────────────────────────────────────────────

/**
 * POST /api/workflow/head-edit
 * Edit the face/head region of a character image
 * Body: { imageBase64, editDescription, editType, model }
 * Optional: reference image in multipart form field 'referenceImage'
 */
router.post('/head-edit', upload.single('referenceImage'), async (req, res) => {
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { imageBase64, editDescription, editType, model } = body;
        const apiKey = req.headers['x-api-key'];

        if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });
        if (!editDescription) return res.status(400).json({ error: 'Missing editDescription' });

        // Optional reference image
        let hasReference = false;
        const refImages = [{ data: imageBase64, mimeType: 'image/png' }];

        if (req.file) {
            refImages.push({
                data: req.file.buffer.toString('base64'),
                mimeType: req.file.mimetype,
            });
            hasReference = true;
        } else if (body.referenceBase64) {
            refImages.push({ data: body.referenceBase64, mimeType: 'image/png' });
            hasReference = true;
        }

        const prompt = promptEngine.buildHeadEditPrompt(editDescription, {
            editType: editType || 'face_tattoo',
            preserveIdentity: true,
            hasReference,
        });

        console.log(`[Head Edit] editType=${editType} | hasRef=${hasReference} | model=${model || 'pro'}`);

        const result = await gemini.editWithReferences(refImages, prompt, {
            model: model || 'pro',
            aspectRatio: '1:1',
            apiKey,
        });

        if (!result.imageBase64) {
            return res.status(500).json({ error: 'Head edit failed — no image returned' });
        }

        const saved = await imageProcessor.saveBase64Image(result.imageBase64);
        res.json({
            success: true,
            text: result.text,
            image: {
                path: `/api/images/generated/${saved.filename}`,
                width: saved.width,
                height: saved.height,
                imageBase64: result.imageBase64,
            },
        });
    } catch (error) {
        console.error('[Head Edit Error]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/workflow/head-composite
 * Composite an edited head onto the original full-body model
 * Body: { bodyBase64, headBase64, model }
 */
router.post('/head-composite', express.json({ limit: '100mb' }), async (req, res) => {
    try {
        const { bodyBase64, headBase64, model } = req.body;
        const apiKey = req.headers['x-api-key'];

        if (!bodyBase64 || !headBase64) {
            return res.status(400).json({ error: 'Missing bodyBase64 or headBase64' });
        }

        const images = [
            { data: bodyBase64, mimeType: 'image/png' }, // [IMAGE 1] = full body
            { data: headBase64, mimeType: 'image/png' }, // [IMAGE 2] = edited head
        ];

        console.log(`[Head Composite] Compositing edited head onto body | model=${model || 'pro'}`);

        const result = await gemini.editWithReferences(images, promptEngine.HEAD_COMPOSITE_PROMPT, {
            model: model || 'pro',
            aspectRatio: '1:1',
            apiKey,
        });

        if (!result.imageBase64) {
            return res.status(500).json({ error: 'Head composite failed — no image returned' });
        }

        const saved = await imageProcessor.saveBase64Image(result.imageBase64);
        res.json({
            success: true,
            text: result.text,
            image: {
                path: `/api/images/generated/${saved.filename}`,
                width: saved.width,
                height: saved.height,
                imageBase64: result.imageBase64,
            },
        });
    } catch (error) {
        console.error('[Head Composite Error]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/workflow/pixel-recover
 * Restore pixel quality on a degraded image (after multiple incremental edits)
 * Body: { imageBase64, model }
 */
router.post('/pixel-recover', express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { imageBase64, model } = req.body;
        const apiKey = req.headers['x-api-key'];

        if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

        const prompt = `${promptEngine.PIXEL_RECOVERY_PROMPT}

[RECOVERY TASK]
The image provided has accumulated quality loss from multiple AI editing passes.
Your ONLY job is to RESTORE its sharpness, crisp edges, vivid colors, and fine detail.
DO NOT change the character's appearance, outfit, pose, background, or any artistic content.
Output the EXACT same image but pixel-perfect, sharpened, and artifact-free.
Treat this as an image restoration task, not an image generation task.`;

        console.log(`[Pixel Recover] Recovering pixel quality | model=${model || 'pro'}`);

        const result = await gemini.editWithReferences(
            [{ data: imageBase64, mimeType: 'image/png' }],
            prompt,
            { model: model || 'pro', aspectRatio: '1:1', apiKey }
        );

        if (!result.imageBase64) {
            return res.status(500).json({ error: 'Pixel recovery failed — no image returned' });
        }

        const saved = await imageProcessor.saveBase64Image(result.imageBase64);
        res.json({
            success: true,
            image: {
                path: `/api/images/generated/${saved.filename}`,
                width: saved.width,
                height: saved.height,
                imageBase64: result.imageBase64,
            },
        });
    } catch (error) {
        console.error('[Pixel Recover Error]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

