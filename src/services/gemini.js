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
let aiFallback = null; // Secondary Vertex client (fallback key)

/**
 * Initialize the Gemini AI client.
 *
 * Uses apiKey-only mode (matching Google's official Vertex AI sample code).
 * The @google/genai SDK with just apiKey routes through generativelanguage.googleapis.com
 * which correctly handles Vertex AI API keys without ADC conflicts.
 *
 * Supports dual API keys: VERTEX_API_KEY_PRIMARY (main) + VERTEX_API_KEY (fallback)
 */
function initGemini(apiKey) {
    const primaryKey = process.env.VERTEX_API_KEY_PRIMARY;
    const fallbackKey = process.env.VERTEX_API_KEY;
    const activeKey = primaryKey || fallbackKey || apiKey;

    // Priority 1: Vertex AI API Key (Primary)
    if (activeKey && activeKey !== 'YOUR_API_KEY_HERE') {
        ai = new GoogleGenAI({ apiKey: activeKey });
        const keyLabel = primaryKey ? 'Primary' : (fallbackKey ? 'Single' : 'AI Studio');
        console.log(`[Gemini] ✅ Client initialized (${keyLabel} Key)`);

        // Init fallback client if secondary key exists and differs from primary
        if (primaryKey && fallbackKey && fallbackKey !== primaryKey) {
            aiFallback = new GoogleGenAI({ apiKey: fallbackKey });
            console.log(`[Gemini] ✅ Fallback client initialized (Secondary Key)`);
        }
    } else {
        console.warn('[Gemini] No valid API key found. Set VERTEX_API_KEY_PRIMARY or VERTEX_API_KEY in .env');
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
 * Get the fallback AI client (secondary Vertex key)
 */
function getFallbackAI() {
    return aiFallback;
}

/**
 * Check if an error is a quota/rate-limit error
 */
function isQuotaError(error) {
    return error.status === 429 
        || error.status === 500
        || error.status === 503
        || (error.message && error.message.includes('429')) 
        || (error.message && error.message.includes('RESOURCE_EXHAUSTED'))
        || (error.message && error.message.includes('Internal error encountered'));
}

/**
 * Handle transient Google API 429 Resource Exhausted errors.
 * Strategy: Try primary → wait with backoff → try fallback → throw to user.
 * Does NOT retry in a tight loop to avoid multiplying quota pressure.
 */
async function withRetry(client, options) {
    let lastError;

    // Phase 1: Try with primary client
    try {
        return await client.models.generateContent(options);
    } catch (error) {
        lastError = error;
        if (!isQuotaError(error)) {
            throw error; // Non-quota error — fail immediately
        }
    }

    // Phase 2: Primary got 429 — wait before trying fallback to avoid burst
    const fallback = getFallbackAI();
    if (fallback && fallback !== client) {
        console.warn(`[Gemini] ⚠️ Primary key quota hit! Waiting 5s then switching to fallback...`);
        await new Promise(res => setTimeout(res, 5000));
        try {
            return await fallback.models.generateContent(options);
        } catch (error) {
            lastError = error;
            console.error(`[Gemini] ❌ Fallback Vertex key also failed: ${error.message}`);
        }
    }

    // Phase 3: Both failed — one more retry after longer backoff
    console.warn(`[Gemini] ⏳ All keys exhausted. Waiting 15s for quota recovery...`);
    await new Promise(res => setTimeout(res, 15000));
    try {
        return await client.models.generateContent(options);
    } catch (error) {
        lastError = error;
    }

    // Pass the error to the frontend so the user can manually hit "Thử lại"
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
    const slotOrder = [
        'base', 'face_ref', 
        'onepiece', 'jacket', 'top_outer', 'top_inner', 'bottom', 'skirt', 'stockings', 'footwear', 
        'head', 'hair', 'face', 'glasses', 'beard', 'tattoo', 'earring',
        'gloves', 'scarf', 'belt', 'necklace', 'bracelet', 'top' // legacy 'top' at end
    ];
    const slotLabels = {
        base: 'BASE CHARACTER IMAGE',
        face_ref: 'FACE REFERENCE',
        // Outfits
        onepiece: 'ONE-PIECE OUTFIT SLOT REFERENCE',
        jacket: 'JACKET/COAT SLOT REFERENCE',
        top_outer: 'OUTER SHIRT SLOT REFERENCE',
        top_inner: 'INNER SHIRT SLOT REFERENCE',
        bottom: 'PANTS/LOWER BODY SLOT REFERENCE',
        skirt: 'SKIRT SLOT REFERENCE',
        stockings: 'STOCKINGS/SOCKS SLOT REFERENCE',
        footwear: 'FOOTWEAR SLOT REFERENCE',
        // Face & Head
        head: 'HEAD SLOT REFERENCE',
        hair: 'HAIR SLOT REFERENCE',
        face: 'FACE SLOT REFERENCE',
        glasses: 'EYEWEAR/GLASSES SLOT REFERENCE',
        beard: 'BEARD/FACIAL HAIR SLOT REFERENCE',
        tattoo: 'FACE TATTOO SLOT REFERENCE',
        earring: 'EARRING SLOT REFERENCE',
        // Accessories
        gloves: 'GLOVES SLOT REFERENCE',
        scarf: 'SCARF/NECKWEAR SLOT REFERENCE',
        belt: 'BELT SLOT REFERENCE',
        necklace: 'NECKLACE/CHAIN SLOT REFERENCE',
        bracelet: 'BRACELET/WRIST ACCESSORY SLOT REFERENCE',
        // Legacy
        top: 'TOP/UPPER BODY SLOT REFERENCE',
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
        throw new Error(`Google từ chối phản hồi (No Candidates). Lý do ngầm: ${JSON.stringify(response.promptFeedback || response)}`);
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

/**
 * Upscale an image to 2x resolution using Vertex AI / Imagen 3.0 upscale
 * @param {string} base64Image - Base64 encoded image
 * @param {Object} params - Generation parameters (API key, etc.)
 * @returns {Object} { imageBase64, mimeType }
 */
async function upscaleImage(base64Image, params = {}) {
    const rawBase64 = cleanBase64Data(base64Image);
    const projectId = process.env.VERTEX_PROJECT;
    const location = process.env.VERTEX_LOCATION;
    const apiKey = params.apiKey || process.env.VERTEX_API_KEY;

    if (!projectId || !location) {
        throw new Error('Cần cấu hình VERTEX_PROJECT và VERTEX_LOCATION để kích hoạt Google Upscaler.');
    }

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagegeneration@006:predict`;

    console.log(`[Gemini/Vertex] Call Upscale API (x2) | Project: ${projectId}`);

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['x-goog-api-key'] = apiKey;
    } else {
        throw new Error('Chưa cấu hình VERTEX_API_KEY để chứng thực Upscaler.');
    }

    const body = {
        instances: [{
            prompt: "Upscale image to enhance details and resolution",
            image: { bytesBase64Encoded: rawBase64 }
        }],
        parameters: { 
            sampleCount: 1, 
            upscaleConfig: { upscaleFactor: "x2" } 
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    const data = await res.json();
    
    if (!res.ok) {
        console.error('[Gemini/Vertex] Upscale Error:', data);
        const errMsg = data.error?.message || data.error?.details?.[0]?.message || res.statusText;
        throw new Error(`Google Upscale API Error: ${errMsg}`);
    }

    if (data.predictions && data.predictions.length > 0) {
        // Vertex might return bytesBase64Encoded
        const outBase64 = data.predictions[0].bytesBase64Encoded;
        return {
            imageBase64: outBase64,
            mimeType: data.predictions[0].mimeType || 'image/png'
        };
    }

    throw new Error('Lỗi Google: Không trả về ảnh Upscale.');
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
    upscaleImage,
    chatEdit,
    parseResponse,
};
