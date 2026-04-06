// =============================================================================
// 3K Nanobana — Gemini API Service
// =============================================================================
// Core integration with Gemini Image API (Nano Banana Pro / Nano Banana 2)
// Handles text-to-image, image editing, and multi-turn chat sessions
// =============================================================================

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

// Model registry — official model IDs
const MODELS = {
    pro: {
        id: 'gemini-3-pro-image-preview',
        name: 'Gemini 3 Pro Image (Nano Banana Pro)',
        description: 'Professional asset production, advanced reasoning',
        maxReferenceImages: 14,
    },
    flash: {
        id: 'gemini-3.1-flash-image-preview',
        name: 'Nano Banana 2',
        description: 'Speed & efficiency, high-volume tasks',
        maxReferenceImages: 14,
    },
    flash25: {
        id: 'gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image',
        description: 'Fast generation with object addition capabilities',
        maxReferenceImages: 14,
    },
};

let ai = null;

/**
 * Initialize the Gemini AI client (AI Studio API Key or Vertex AI)
 */
function initGemini(apiKey) {
    // Priority 1: Vertex AI with API Key
    if (process.env.VERTEX_PROJECT && process.env.VERTEX_LOCATION && process.env.VERTEX_API_KEY) {
        ai = new GoogleGenAI({ 
            apiKey: process.env.VERTEX_API_KEY 
        });
        console.log(`[Gemini] Client initialized (Vertex AI / Custom Key)`);
    }
    // Priority 2: Vertex AI with ADC (Application Default Credentials)
    else if (process.env.VERTEX_PROJECT && process.env.VERTEX_LOCATION) {
        if (process.env.GEMINI_API_KEY) delete process.env.GEMINI_API_KEY;
        ai = new GoogleGenAI({
            vertexai: true,
            project: process.env.VERTEX_PROJECT,
            location: process.env.VERTEX_LOCATION
        });
        console.log(`[Gemini] Client initialized (Vertex AI ADC: ${process.env.VERTEX_PROJECT})`);
    }
    // Priority 3: AI Studio API Key
    else if (apiKey && apiKey !== 'YOUR_API_KEY_HERE') {
        ai = new GoogleGenAI({ apiKey });
        console.log('[Gemini] Client initialized (AI Studio API Key)');
    } else {
        console.warn('[Gemini] No valid configuration found.');
    }
    return ai;
}

/**
 * Get the AI client instance, strictly prioritizing server .env configuration
 */
function getAI(requestApiKey = null) {
    // Priority 1: If the server administrator has initialized a global AI instance via .env, 
    // strictly use it and IGNORE any outdated keys sent from the user's browser localStorage.
    if (ai) return ai;

    // Priority 2: If the server is empty (no .env configured), allow Bring-Your-Own-Key from frontend
    if (requestApiKey) return new GoogleGenAI({ apiKey: requestApiKey });

    throw new Error('Gemini AI not initialized. Set VERTEX_API_KEY or GEMINI_API_KEY in .env, or input one in Settings.');
}

/**
 * Handle transient Google API 429 Resource Exhausted errors via exponential backoff
 */
async function withRetry(client, options, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await client.models.generateContent(options);
        } catch (error) {
            lastError = error;
            if (error.status === 429 || (error.message && error.message.includes('429')) || (error.message && error.message.includes('RESOURCE_EXHAUSTED'))) {
                const waitTime = Math.pow(2, i) * 2000 + Math.random() * 1000;
                console.warn(`[Gemini] 429 Quota limit hit (Attempt ${i + 1}/${maxRetries}). Retrying in ${Math.round(waitTime)}ms...`);
                await new Promise(res => setTimeout(res, waitTime));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

/**
 * Strip data URL prefix if present to prevent Vertex AI "Unable to process input image" errors
 */
function cleanBase64Data(data) {
    if (typeof data !== 'string') return data;
    const commaIdx = data.indexOf(',');
    if (data.startsWith('data:') && commaIdx !== -1) {
        return data.substring(commaIdx + 1).trim();
    }
    return data;
}

/**
 * Auto-detect MIME type from raw Base64 signature
 */
function detectMimeTypeFromBase64(base64) {
    if (!base64 || typeof base64 !== 'string') return 'image/png';
    // Remove prefix if it accidentally sneaks through
    const pureBase64 = cleanBase64Data(base64);
    
    // Check magic bytes signatures encoded in base64
    if (pureBase64.startsWith('/9j/')) return 'image/jpeg';
    if (pureBase64.startsWith('iVBORw0KGgo')) return 'image/png';
    if (pureBase64.startsWith('UklGR')) return 'image/webp';
    if (pureBase64.startsWith('R0lGOD')) return 'image/gif';
    
    // Fallback
    return 'image/png';
}

/**
 * Get model config by key ('pro' or 'flash')
 */
function getModel(key = 'pro') {
    return MODELS[key] || MODELS.pro;
}

/**
 * Build generation config from user parameters
 * @param {Object} params - User-specified parameters
 * @returns {Object} Config object for Gemini API
 */
function buildConfig(params = {}) {
    const config = {
        responseModalities: ['TEXT', 'IMAGE'],
    };

    // Image configuration — note: imageSize is NOT supported by Gemini image models
    // Max native output is ~1024px. Use Upscale endpoint for higher res.
    const imageConfig = {};
    if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
    if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;

    return config;
}

/**
 * Generate an image from text prompt only
 * @param {string} prompt - Text description
 * @param {Object} params - Generation parameters
 * @returns {Object} { text, imageBase64, mimeType }
 */
async function generateImage(prompt, params = {}) {
    const model = getModel(params.model);
    const config = buildConfig(params);

    console.log(`[Gemini] Text→Image | Model: ${model.name} | Prompt: "${prompt.substring(0, 80)}..."`);

    const client = getAI(params.apiKey);

    const response = await withRetry(client, {
        model: model.id,
        contents: prompt,
        config,
    });

    return parseResponse(response);
}

/**
 * Edit an existing image with a text prompt
 * @param {Buffer|string} imageData - Image buffer or base64 string
 * @param {string} mimeType - Image MIME type
 * @param {string} prompt - Edit instruction
 * @param {Object} params - Generation parameters
 * @returns {Object} { text, imageBase64, mimeType }
 */
async function editImage(imageData, mimeType, prompt, params = {}) {
    const model = getModel(params.model);
    const config = buildConfig(params);

    // Convert buffer to base64 if needed
    const base64 = Buffer.isBuffer(imageData) 
        ? imageData.toString('base64') 
        : imageData;

    console.log(`[Gemini] Image+Text→Image | Model: ${model.name} | Prompt: "${prompt.substring(0, 80)}..."`);

    // Image FIRST for better model attention to source image
    const parts = [
        {
            inlineData: {
                mimeType: detectMimeTypeFromBase64(base64),
                data: cleanBase64Data(base64),
            },
        },
        { text: prompt },
    ];

    const contents = [{ role: 'user', parts }];

    const client = getAI(params.apiKey);

    const response = await withRetry(client, {
        model: model.id,
        contents,
        config,
    });

    return parseResponse(response);
}

/**
 * Edit with multiple reference images (up to 14)
 * @param {Array<{data: string, mimeType: string}>} images - Array of base64 images
 * @param {string} prompt - Edit instruction
 * @param {Object} params - Generation parameters
 * @returns {Object} { text, imageBase64, mimeType }
 */
async function editWithReferences(images, prompt, params = {}) {
    const model = getModel(params.model);
    const config = buildConfig(params);

    console.log(`[Gemini] Multi-ref edit | ${images.length} images | Model: ${model.name}`);

    // Images FIRST for better model attention to source content
    const parts = [
        ...images.map(img => ({
            inlineData: {
                mimeType: detectMimeTypeFromBase64(img.data),
                data: cleanBase64Data(img.data),
            },
        })),
        { text: prompt },
    ];

    const contents = [{ role: 'user', parts }];

    const client = getAI(params.apiKey);

    const response = await withRetry(client, {
        model: model.id,
        contents,
        config,
    });

    return parseResponse(response);
}

/**
 * Edit with slot-labeled reference images (Modular Outfit System)
 * Each image is annotated with its slot role for Gemini to understand
 * @param {Object} slotImages - { base: [{data, mimeType}], head: [...], face: [...], top: [...], bottom: [...], footwear: [...] }
 * @param {string} prompt - Edit instruction (should be from buildModularOutfitPrompt)
 * @param {Object} params - Generation parameters
 * @returns {Object} { text, imageBase64, mimeType }
 */
async function editWithSlotReferences(slotImages, prompt, params = {}) {
    const model = getModel(params.model);
    const config = buildConfig(params);

    // Build contents with slot labels — order matters for Gemini's understanding
    const parts = [{ text: prompt }];

    // Slot processing order (priority for 14-image limit)
    const slotOrder = ['base', 'face_ref', 'head', 'face', 'top', 'bottom', 'footwear'];
    const slotLabels = {
        base: 'BASE CHARACTER IMAGE',
        face_ref: 'FACE REFERENCE',
        head: 'HEAD SLOT REFERENCE',
        face: 'FACE SLOT REFERENCE',
        top: 'TOP/UPPER BODY SLOT REFERENCE',
        bottom: 'BOTTOM/LOWER BODY SLOT REFERENCE',
        footwear: 'FOOTWEAR SLOT REFERENCE',
    };

    let imageCount = 0;
    const maxImages = model.maxReferenceImages || 14;

    for (const slot of slotOrder) {
        const images = slotImages[slot];
        if (!images || images.length === 0) continue;

        for (let i = 0; i < images.length; i++) {
            if (imageCount >= maxImages) {
                console.warn(`[Gemini] Hit ${maxImages} image limit, skipping remaining slot images`);
                break;
            }

            // Add text label before each image
            const label = slotLabels[slot] || slot.toUpperCase();
            const suffix = images.length > 1 ? ` (${i + 1}/${images.length})` : '';
            parts.push({ text: `[REFERENCE: ${label}${suffix}]` });

            parts.push({
                inlineData: {
                    mimeType: detectMimeTypeFromBase64(images[i].data),
                    data: cleanBase64Data(images[i].data),
                },
            });
            imageCount++;
        }

        if (imageCount >= maxImages) break;
    }

    console.log(`[Gemini] Slot-ref edit | ${imageCount} images across ${Object.keys(slotImages).filter(k => slotImages[k]?.length > 0).length} slots | Model: ${model.name}`);

    const contents = [{ role: 'user', parts }];
    const client = getAI(params.apiKey);

    const response = await withRetry(client, {
        model: model.id,
        contents,
        config,
    });

    return parseResponse(response);
}

/**
 * Multi-turn chat session for stateful editing
 * Rebuilds conversation from message history each call (stateless server)
 * @param {Array} history - Previous messages [{role, parts}]
 * @param {string} newPrompt - New edit instruction
 * @param {Array} newImages - New images to include with prompt
 * @param {Object} params - Generation parameters
 * @returns {Object} { text, imageBase64, mimeType }
 */
async function chatEdit(history, newPrompt, newImages = [], params = {}) {
    const model = getModel(params.model);
    const config = buildConfig(params);

    console.log(`[Gemini] Chat edit | History: ${history.length} turns | Model: ${model.name}`);

    // Build the contents array from history
    const contents = [];

    // Add historical messages
    for (const msg of history) {
        contents.push(msg);
    }

    // Add the new user message
    const newParts = [{ text: newPrompt }];
    for (const img of newImages) {
        newParts.push({
            inlineData: {
                mimeType: img.mimeType || 'image/png',
                data: cleanBase64Data(img.data),
            },
        });
    }
    contents.push({ role: 'user', parts: newParts });

    const client = getAI(params.apiKey);

    const response = await withRetry(client, {
        model: model.id,
        contents,
        config,
    });

    return parseResponse(response);
}

/**
 * Parse Gemini API response into a clean format
 */
function parseResponse(response) {
    const result = {
        text: null,
        imageBase64: null,
        mimeType: null,
        thoughts: [],
    };

    if (!response.candidates || response.candidates.length === 0) {
        throw new Error('No response candidates from Gemini API');
    }

    const candidate = response.candidates[0];
    
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`Bị chặn bởi bộ lọc: ${candidate.finishReason}`);
    }

    const parts = candidate.content?.parts || [];
    if (parts.length === 0 && !result.text && !result.imageBase64) {
        throw new Error(`API trả về rỗng. Căn nguyên: ${candidate.finishReason || 'Unknown'}`);
    }

    for (const part of parts) {
        // Skip thought parts (they are billed but not user-facing)
        if (part.thought) {
            if (part.text) result.thoughts.push(part.text);
            continue;
        }

        if (part.text) {
            result.text = (result.text || '') + part.text;
        } else if (part.inlineData) {
            result.imageBase64 = part.inlineData.data;
            result.mimeType = part.inlineData.mimeType || 'image/png';
        }
    }

    return result;
}

module.exports = {
    MODELS,
    initGemini,
    getAI,
    getModel,
    buildConfig,
    generateImage,
    editImage,
    editWithReferences,
    editWithSlotReferences,
    chatEdit,
    parseResponse,
};
