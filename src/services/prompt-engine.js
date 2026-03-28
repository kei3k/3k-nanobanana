// =============================================================================
// 3K Nanobana — Prompt Engineering Engine
// =============================================================================
// Transforms user parameters (denoising, identity lock, etc.) into
// optimized prompts for Gemini API. Since Gemini has no native denoising
// or seed parameters, we use prompt engineering to achieve similar effects.
// =============================================================================

/**
 * Denoising strength mapping table
 * Maps 0.0-1.0 slider value to prompt phrasing that controls edit intensity
 */
const DENOISING_LEVELS = {
    0.0: 'Make absolutely no changes to the image. Return it exactly as-is.',
    0.1: 'Make the absolute minimum change possible. Change only the single element mentioned and preserve everything else with pixel-perfect accuracy.',
    0.2: 'Make very subtle changes only. Keep 95% of the image completely untouched.',
    0.3: 'Make minor adjustments while preserving the vast majority of the original composition, colors, and details.',
    0.4: 'Make moderate but conservative changes. Preserve the overall composition and most details.',
    0.5: 'Apply balanced edits. Modify the requested elements while maintaining the general style and composition.',
    0.6: 'Apply noticeable changes while keeping the core subject and composition recognizable.',
    0.7: 'Make significant modifications. Feel free to reinterpret elements while keeping the basic scene structure.',
    0.8: 'Make dramatic changes. Substantially reimagine the requested elements with creative freedom.',
    0.9: 'Make very dramatic changes. Reimagine most elements with high creative freedom.',
    1.0: 'Completely reimagine and transform the entire image. Use the original only as loose inspiration.',
};

/**
 * Get the nearest denoising level description
 */
function getDenoisingPrompt(strength = 0.5) {
    const clamped = Math.max(0, Math.min(1, strength));
    const rounded = Math.round(clamped * 10) / 10;
    return DENOISING_LEVELS[rounded] || DENOISING_LEVELS[0.5];
}

/**
 * Identity Lock prompt injection
 * Ensures facial features and identity are preserved during edits
 */
const IDENTITY_LOCK_PROMPT = `[CRITICAL CONSTRAINT — IDENTITY PRESERVATION]
You MUST preserve the exact facial features, identity, face shape, skin tone, 
eye color, eyebrow shape, nose structure, lip shape, and all distinguishing 
facial characteristics of every person in the image. The person must be 
immediately recognizable as the same individual. Do NOT alter, age, de-age, 
or modify any facial features. Use the original face as an absolute reference.`;

/**
 * Texture Preservation prompt injection
 * Maintains material quality and surface detail fidelity
 */
const TEXTURE_PRESERVATION_PROMPT = `[QUALITY CONSTRAINT — TEXTURE FIDELITY]
Maintain all material textures at maximum fidelity: fabric weave patterns, 
skin pores and micro-details, hair strands, metal reflections, wood grain, 
stone surfaces, and all other material properties. Preserve the original 
image's level of detail, sharpness, and photographic quality. Do not smooth, 
blur, or simplify any textures.`;

/**
 * Seed simulation prompt
 * Creates a deterministic style anchor descriptor
 */
function getSeedPrompt(seed) {
    if (seed === null || seed === undefined) return '';
    
    // Generate deterministic style descriptors from seed
    const styles = [
        'warm cinematic', 'cool editorial', 'golden hour', 'studio flash',
        'overcast soft', 'high contrast', 'muted pastel', 'rich saturated',
        'film grain analog', 'clean digital', 'vintage faded', 'HDR vivid',
    ];
    const compositions = [
        'centered symmetrical', 'rule of thirds', 'diagonal leading lines',
        'frame within frame', 'negative space emphasis', 'tight crop',
    ];
    const tones = [
        'neutral balanced', 'warm amber', 'cool blue', 'green tinted',
        'magenta shifted', 'orange and teal', 'monochromatic desaturated',
    ];

    const styleIdx = seed % styles.length;
    const compIdx = Math.floor(seed / styles.length) % compositions.length;
    const toneIdx = Math.floor(seed / (styles.length * compositions.length)) % tones.length;

    return `[STYLE ANCHOR #${seed}] Use a ${styles[styleIdx]} lighting style, ` +
           `${compositions[compIdx]} composition, with ${tones[toneIdx]} color grading. ` +
           `Maintain this exact visual style consistently.`;
}

/**
 * Region masking prompt from canvas coordinates
 * Converts mask bounding box to semantic region description
 * @param {Object} mask - { x, y, width, height, imageWidth, imageHeight, brushStrokes }
 * @returns {string} Semantic region description
 */
function getMaskRegionPrompt(mask) {
    if (!mask) return '';

    const { x, y, width, height, imageWidth, imageHeight } = mask;
    
    // Calculate relative positions
    const centerX = (x + width / 2) / imageWidth;
    const centerY = (y + height / 2) / imageHeight;
    const relWidth = width / imageWidth;
    const relHeight = height / imageHeight;

    // Determine position description
    let horizontal, vertical;
    if (centerX < 0.33) horizontal = 'left';
    else if (centerX < 0.66) horizontal = 'center';
    else horizontal = 'right';

    if (centerY < 0.33) vertical = 'top';
    else if (centerY < 0.66) vertical = 'middle';
    else vertical = 'bottom';

    // Determine size description
    let sizeDesc;
    const area = relWidth * relHeight;
    if (area < 0.05) sizeDesc = 'a small area';
    else if (area < 0.15) sizeDesc = 'a moderate area';
    else if (area < 0.4) sizeDesc = 'a large area';
    else sizeDesc = 'most of the image';

    return `[REGION CONSTRAINT] Apply changes ONLY to ${sizeDesc} in the ` +
           `${vertical}-${horizontal} portion of the image (approximately ` +
           `${Math.round(relWidth * 100)}% wide × ${Math.round(relHeight * 100)}% tall). ` +
           `Leave ALL other areas of the image completely untouched and unmodified.`;
}

/**
 * Build the complete enhanced prompt from user input and parameters
 * @param {string} userPrompt - Raw user edit instruction
 * @param {Object} params - Enhancement parameters
 * @returns {string} Full engineered prompt
 */
function buildEnhancedPrompt(userPrompt, params = {}) {
    const parts = [];

    // 1. Identity Lock (if enabled)
    if (params.identityLock) {
        parts.push(IDENTITY_LOCK_PROMPT);
    }

    // 2. Texture Preservation (if enabled)
    if (params.texturePreservation) {
        parts.push(TEXTURE_PRESERVATION_PROMPT);
    }

    // 3. Denoising strength instruction
    if (params.denoisingStrength !== undefined && params.denoisingStrength !== null) {
        parts.push(`[EDIT INTENSITY] ${getDenoisingPrompt(params.denoisingStrength)}`);
    }

    // 4. Seed-based style anchor
    if (params.seed !== undefined && params.seed !== null) {
        const seedPrompt = getSeedPrompt(params.seed);
        if (seedPrompt) parts.push(seedPrompt);
    }

    // 5. Region masking
    if (params.mask) {
        parts.push(getMaskRegionPrompt(params.mask));
    }

    // 6. User's actual prompt (always last for maximum weight)
    parts.push(userPrompt);

    return parts.join('\n\n');
}

/**
 * Build an upscale prompt
 */
function buildUpscalePrompt() {
    return `Upscale this image to the highest possible resolution and quality. 
Enhance all details, textures, and sharpness without changing any content, 
composition, colors, or style. The result should be a perfect high-resolution 
version of the exact same image.`;
}

module.exports = {
    getDenoisingPrompt,
    getSeedPrompt,
    getMaskRegionPrompt,
    buildEnhancedPrompt,
    buildUpscalePrompt,
    IDENTITY_LOCK_PROMPT,
    TEXTURE_PRESERVATION_PROMPT,
};
