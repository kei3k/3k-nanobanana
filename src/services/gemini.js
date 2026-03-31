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
        name: 'Nano Banana Pro',
        description: 'Professional asset production, advanced reasoning',
        maxReferenceImages: 14,
    },
    flash: {
        id: 'gemini-3.1-flash-image-preview',
        name: 'Nano Banana 2',
        description: 'Speed & efficiency, high-volume tasks',
        maxReferenceImages: 14,
    },
};

let ai = null;

/**
 * Initialize the Gemini AI client (AI Studio API Key or Vertex AI)
 */
function initGemini(apiKey) {
    // Priority 1: AI Studio API Key (if explicitly set and not empty/placeholder)
    if (apiKey && apiKey !== 'YOUR_API_KEY_HERE') {
        ai = new GoogleGenAI({ apiKey });
        console.log('[Gemini] Client initialized (AI Studio API Key)');
    } 
    // Priority 2: Google Cloud Vertex AI
    else if (process.env.VERTEX_PROJECT && process.env.VERTEX_LOCATION) {
        // Prevent SDK from accidentally grabbing the API key from the environment
        if (process.env.GEMINI_API_KEY) {
            delete process.env.GEMINI_API_KEY;
        }

        ai = new GoogleGenAI({
            vertexai: {
                project: process.env.VERTEX_PROJECT,
                location: process.env.VERTEX_LOCATION
            }
        });
        console.log(`[Gemini] Client initialized (Vertex AI: ${process.env.VERTEX_PROJECT})`);
    } else {
        console.warn('[Gemini] No valid configuration found.');
    }
    return ai;
}

/**
 * Get the AI client instance, prioritizing request-level key
 */
function getAI(requestApiKey = null) {
    if (requestApiKey) return new GoogleGenAI({ apiKey: requestApiKey });
    
    // Support Vertex AI when no request API key is provided        // Fallback to Vertex AI
    if (!ai && process.env.VERTEX_PROJECT && process.env.VERTEX_LOCATION) {
        if (process.env.GEMINI_API_KEY) delete process.env.GEMINI_API_KEY;
        return new GoogleGenAI({
            vertexai: {
                project: process.env.VERTEX_PROJECT,
                location: process.env.VERTEX_LOCATION
            }
        });
    }

    if (!ai) throw new Error('Gemini AI not initialized. Please provide an API key in the UI settings or configure Vertex AI in .env.');
    return ai;
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

    // Image configuration
    const imageConfig = {};
    if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
    if (params.imageSize) imageConfig.imageSize = params.imageSize;
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

    const contents = [
        { text: prompt },
        {
            inlineData: {
                mimeType: mimeType || 'image/png',
                data: base64,
            },
        },
    ];

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

    const contents = [
        { text: prompt },
        ...images.map(img => ({
            inlineData: {
                mimeType: img.mimeType || 'image/png',
                data: img.data,
            },
        })),
    ];

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
                data: img.data,
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

    const parts = response.candidates[0].content.parts;

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
    chatEdit,
    parseResponse,
};
