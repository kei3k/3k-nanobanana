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

const gemini = require('../services/gemini');
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
            return res.json({
                success: true,
                text: finalText,
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
        const prompt = promptEngine.buildWorkflowPrompt(nodeConfig);
        
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
            return await executeAINode(step, previousResults, uploadedImages, apiKey, {
                pose: config.pose || config.description || 'standing pose',
            });
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

    // Collect inputs from connected nodes
    let faceRefCount = 0;
    const slotImages = { base: [], face_ref: [], head: [], face: [], top: [], bottom: [], footwear: [] };
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

    // Build component data from node config
    const slots = ['head', 'face', 'top', 'bottom', 'footwear'];
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

    // Build the modular prompt
    const prompt = promptEngine.buildModularOutfitPrompt(components, {
        preserveFace: config.preserveFace !== false,
        isOnePiece: config.isOnePiece || false,
        bodyType: anatomyData?.bodyType || config.bodyType || 'standard',
        style: config.style,
        denoisingStrength: config.denoisingStrength,
        faceRefCount,
        anatomyData,
    });

    const genParams = {
        model: config.model || 'pro',
        aspectRatio: config.aspectRatio || '1:1',
        apiKey,
    };

    // Use slot-labeled references if we have slot-specific images
    const hasSlotImages = slots.some(s => slotImages[s].length > 0);

    let result;
    if (hasSlotImages || slotImages.base.length > 0 || slotImages.face_ref.length > 0) {
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
 */
async function executeMultiViewOutput(step, previousResults, uploadedImages, apiKey) {
    const { inputs, config } = step;

    // Find the input image and its generating context
    let sourceImage = null;
    let sourcePrompt = '';

    for (const input of inputs) {
        const prev = previousResults[input.sourceId];
        if (prev && prev.imageBase64) {
            sourceImage = { data: prev.imageBase64, mimeType: prev.mimeType || 'image/png' };
            sourcePrompt = prev.text || '';
            break;
        }
    }

    if (!sourceImage) {
        return { text: 'No input image for multi-view output', imageBase64: null, multiViewImages: [] };
    }

    const genParams = {
        model: config.model || 'pro',
        aspectRatio: config.aspectRatio || '1:1',
        apiKey,
    };

    const perspectives = ['front', 'back', 'side'];
    const multiViewImages = [];

    for (const perspective of perspectives) {
        const viewPrompt = promptEngine.buildMultiViewPrompt(
            `Render this exact character from a different camera angle. Maintain the EXACT same outfit, face, body, and all details. ${sourcePrompt}`,
            perspective
        );

        try {
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
            // Continue with other perspectives even if one fails
        }
    }

    return {
        imageBase64: multiViewImages.length > 0 ? multiViewImages[0].imageBase64 : null,
        mimeType: multiViewImages.length > 0 ? multiViewImages[0].mimeType : null,
        text: `Generated ${multiViewImages.length}/3 perspectives`,
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

module.exports = router;
