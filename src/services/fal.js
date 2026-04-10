const sharp = require('sharp');
const apiKey = process.env.FAL_KEY;

// =============================================================================
// Fal.ai Service — Nano Banana models only (queue-based)
// =============================================================================

const FAL_ENDPOINTS = {
    'fal-banana-pro':    { type: 'banana', endpoint: 'fal-ai/nano-banana-pro/edit' },
    'fal-banana-flash':  { type: 'banana', endpoint: 'fal-ai/nano-banana-2/edit' },
};

/**
 * Compress base64 to prevent 504 Gateway Timeouts with huge payloads
 */
async function compressImageForPayload(base64Data, mimeType) {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        const compressedBase64 = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer()
            .then(b => b.toString('base64'));
        return `data:image/jpeg;base64,${compressedBase64}`;
    } catch (e) {
        console.warn('[Fal.ai] Image compression failed, using original size:', e.message);
        return `data:${mimeType || 'image/png'};base64,${base64Data}`;
    }
}

/**
 * AI Generator using Fal.ai Nano Banana models
 * Mirrors the structure of gemini.editWithSlotReferences
 */
async function editWithSlotReferences(slotImages, basePrompt, params = {}) {
    if (!apiKey) throw new Error('FAL_KEY is not configured in .env');

    const modelId = params.model || 'fal-banana-pro';
    const config = FAL_ENDPOINTS[modelId] || FAL_ENDPOINTS['fal-banana-pro'];
    
    // Extract base image
    let sourceImage = null;
    if (slotImages && slotImages.base && slotImages.base.length > 0) {
        sourceImage = slotImages.base[0];
    } else {
        throw new Error('Fal.ai requires a base image to perform Image-to-Image');
    }

    const dataUrl = await compressImageForPayload(sourceImage.data, sourceImage.mimeType);

    return await callNanoBanana(config.endpoint, dataUrl, slotImages, basePrompt, params);
}

/**
 * Call Nano Banana models via Queue API (prevents 502 timeouts)
 * Uses image_urls[] array as required by the API schema
 */
async function callNanoBanana(endpoint, baseDataUrl, slotImages, basePrompt, params = {}) {
    const enhancedPrompt = `3D Game Render style character. ${basePrompt}. Maintain identical anatomy.`;
    
    // Collect all image URLs (base + slot references)
    const imageUrls = [baseDataUrl];
    
    // Add slot reference images if available
    if (slotImages) {
        for (const [slotKey, images] of Object.entries(slotImages)) {
            if (slotKey === 'base') continue;
            if (Array.isArray(images)) {
                for (const img of images) {
                    if (img && img.data) {
                        const compressed = await compressImageForPayload(img.data, img.mimeType);
                        imageUrls.push(compressed);
                    }
                }
            }
        }
    }

    const payload = {
        prompt: enhancedPrompt,
        image_urls: imageUrls,
        num_images: 1,
        aspect_ratio: params.aspectRatio || '1:1',
        output_format: 'png',
        resolution: '1K',
        safety_tolerance: '6',
        limit_generations: true,
    };

    console.log(`[Fal.ai] Submitting to queue: ${endpoint} (${imageUrls.length} images)...`);

    // Step 1: Submit to queue
    const submitRes = await fetchWithRetry(`https://queue.fal.run/${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Key ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!submitRes.ok) {
        const errBody = await submitRes.text();
        throw new Error(`Fal.ai Queue Submit Error: ${submitRes.status} - ${errBody}`);
    }

    const { request_id, status_url, response_url } = await submitRes.json();
    console.log(`[Fal.ai] Queued request: ${request_id}`);

    // Step 2: Poll for completion (max ~3 minutes)
    const maxWait = 180000; // 3 minutes
    const pollInterval = 3000; // 3 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
        await sleep(pollInterval);

        const statusRes = await fetch(status_url, {
            headers: { 'Authorization': `Key ${apiKey}` },
        });

        if (!statusRes.ok) {
            console.warn(`[Fal.ai] Status check failed: ${statusRes.status}`);
            continue;
        }

        const status = await statusRes.json();
        
        if (status.status === 'COMPLETED') {
            console.log(`[Fal.ai] Request completed in ${Math.round((Date.now() - startTime) / 1000)}s`);
            break;
        } else if (status.status === 'FAILED') {
            throw new Error(`Fal.ai generation failed: ${JSON.stringify(status)}`);
        }
        
        // Log progress
        if (status.logs && status.logs.length > 0) {
            const lastLog = status.logs[status.logs.length - 1];
            console.log(`[Fal.ai] ${status.status}: ${lastLog.message || ''}`);
        } else {
            console.log(`[Fal.ai] ${status.status}... (${Math.round((Date.now() - startTime) / 1000)}s)`);
        }
    }

    // Step 3: Fetch result
    const resultRes = await fetch(response_url, {
        headers: { 'Authorization': `Key ${apiKey}` },
    });

    if (!resultRes.ok) {
        const errBody = await resultRes.text();
        throw new Error(`Fal.ai Result Error: ${resultRes.status} - ${errBody}`);
    }

    const data = await resultRes.json();
    
    if (!data.images || data.images.length === 0) {
        throw new Error('Fal.ai Nano Banana returned no images');
    }

    const outUrl = data.images[0].url;
    console.log(`[Fal.ai] Success! Downloading output: ${outUrl.substring(0, 80)}...`);

    // Download result image
    const imgResponse = await fetch(outUrl);
    const arrayBuffer = await imgResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
        imageBase64: base64,
        mimeType: data.images[0].content_type || 'image/png',
        text: `Generated by Fal.ai ${endpoint}`
    };
}




/**
 * Remove background using Fal.ai (Birefnet v2)
 */
async function removeBackground(base64Data, mimeType = 'image/png') {
    if (!apiKey) throw new Error('FAL_KEY is not configured in .env');

    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    
    console.log(`[Fal.ai] Calling Birefnet/v2 for background removal...`);
    
    const response = await fetch('https://fal.run/fal-ai/birefnet/v2', {
        method: 'POST',
        headers: {
            'Authorization': `Key ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            image_url: dataUrl
        })
    });

    if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(`Fal.ai RMBG Error: ${response.status} ${errObj.detail || ''}`);
    }

    const json = await response.json();
    if (!json.image || !json.image.url) {
        throw new Error('Invalid response format from Fal RMBG');
    }

    // Download the resulting image from the URL returned by fal
    const imgRes = await fetch(json.image.url);
    const arrayBuffer = await imgRes.arrayBuffer();
    const resultBase64 = Buffer.from(arrayBuffer).toString('base64');
    
    return {
        imageBase64: resultBase64,
        mimeType: 'image/png'
    };
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry for transient errors (502, 503, 429)
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok || (response.status < 500 && response.status !== 429)) {
                return response;
            }
            // Retryable server error
            const waitTime = Math.pow(2, i) * 2000 + Math.random() * 1000;
            console.warn(`[Fal.ai] ${response.status} error (Attempt ${i + 1}/${maxRetries}). Retrying in ${Math.round(waitTime)}ms...`);
            await sleep(waitTime);
            lastError = new Error(`Fal.ai HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                const waitTime = Math.pow(2, i) * 2000;
                console.warn(`[Fal.ai] Network error (Attempt ${i + 1}/${maxRetries}). Retrying in ${waitTime}ms...`);
                await sleep(waitTime);
            }
        }
    }
    throw lastError;
}

/**
 * Upscale image using Fal.ai (esrgan)
 */
async function upscaleImage(base64Data, scale = 4) {
    if (!apiKey) throw new Error('FAL_KEY is not configured in .env');

    const dataUrl = `data:image/png;base64,${base64Data}`;
    console.log(`[Fal.ai] Calling ESRGAN Upscaler... Scale: ${scale}x`);
    
    const response = await fetch('https://fal.run/fal-ai/esrgan', {
        method: 'POST',
        headers: {
            'Authorization': `Key ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            image_url: dataUrl,
            scale: scale
        })
    });

    if (!response.ok) {
        const errObj = await response.json().catch(() => ({}));
        throw new Error(`Fal.ai Upscale Error: ${response.status} ${errObj.detail || ''}`);
    }

    const json = await response.json();
    if (!json.image || !json.image.url) {
        throw new Error('Invalid response format from Fal Upscale');
    }

    // Download the resulting image
    const imgRes = await fetch(json.image.url);
    const arrayBuffer = await imgRes.arrayBuffer();
    const resultBase64 = Buffer.from(arrayBuffer).toString('base64');
    
    return {
        imageBase64: resultBase64,
        mimeType: 'image/png'
    };
}

module.exports = {
    editWithSlotReferences,
    removeBackground,
    upscaleImage,
    FAL_ENDPOINTS,
};
