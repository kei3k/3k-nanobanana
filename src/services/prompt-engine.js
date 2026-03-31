// =============================================================================
// 3K FreeFire Studio — Prompt Engineering Engine
// =============================================================================
// Transforms workflow node parameters into optimized prompts for Gemini API.
// Specialized for FreeFire character customization: outfit, pose, style, face lock.
// =============================================================================

/**
 * Denoising strength mapping table
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

function getDenoisingPrompt(strength = 0.5) {
    const clamped = Math.max(0, Math.min(1, strength));
    const rounded = Math.round(clamped * 10) / 10;
    return DENOISING_LEVELS[rounded] || DENOISING_LEVELS[0.5];
}

// =============================================================================
// FACE CONSISTENCY SYSTEM (Enhanced for FreeFire)
// =============================================================================

const FACE_CONSISTENCY_PROMPT = `[ABSOLUTE CRITICAL CONSTRAINT — FACE IDENTITY PRESERVATION]
You MUST preserve the EXACT facial identity of the character with ZERO deviation:
- Face shape, jawline, chin structure: IDENTICAL to reference
- Eyes: exact same shape, size, color, pupil details, eyelash pattern
- Nose: exact same bridge width, tip shape, nostril shape  
- Lips: exact same thickness, shape, color
- Eyebrows: exact same arch, thickness, color
- Skin tone and complexion: IDENTICAL throughout
- Facial proportions and symmetry: UNCHANGED
- Hair color and style: PRESERVE unless explicitly asked to change
- Any facial markings, moles, or unique features: PRESERVE exactly
The face MUST be immediately recognizable as the SAME EXACT person.
This constraint overrides ALL other instructions. If there is any conflict, 
ALWAYS prioritize face identity preservation over other changes.
Use the provided reference face image(s) as the absolute ground truth.`;

const FACE_MULTI_ANGLE_PROMPT = `[MULTI-ANGLE FACE REFERENCE]
Multiple reference images of the same person's face are provided from different angles.
Use ALL reference angles to reconstruct the face accurately from the target viewpoint.
Cross-reference between angles to ensure consistency of every facial feature.`;

// =============================================================================
// IDENTITY LOCK (Legacy, still supported)
// =============================================================================

const IDENTITY_LOCK_PROMPT = `[CRITICAL CONSTRAINT — IDENTITY PRESERVATION]
You MUST preserve the exact facial features, identity, face shape, skin tone, 
eye color, eyebrow shape, nose structure, lip shape, and all distinguishing 
facial characteristics of every person in the image. The person must be 
immediately recognizable as the same individual. Do NOT alter, age, de-age, 
or modify any facial features. Use the original face as an absolute reference.`;

// =============================================================================
// TEXTURE PRESERVATION
// =============================================================================

const TEXTURE_PRESERVATION_PROMPT = `[QUALITY CONSTRAINT — TEXTURE FIDELITY]
Maintain all material textures at maximum fidelity: fabric weave patterns, 
skin pores and micro-details, hair strands, metal reflections, wood grain, 
stone surfaces, and all other material properties. Preserve the original 
image's level of detail, sharpness, and photographic quality. Do not smooth, 
blur, or simplify any textures.`;

// =============================================================================
// FREEFIRE CHARACTER CONTEXT
// =============================================================================

const FF_CHARACTER_CONTEXT = `[CONTEXT — FREEFIRE GAME CHARACTER]
This is a character from the mobile game "Garena Free Fire" (also known as Free Fire).
The character design follows Free Fire's art style with detailed game-quality 
character models. Maintain the game's aesthetic quality standards.`;

// =============================================================================
// STYLE TRANSFER PROMPTS
// =============================================================================

const STYLE_PROMPTS = {
    '3d_render': `[STYLE — 3D GAME RENDER]
Render the character as a high-quality 3D game model render, similar to official 
Free Fire character renders. Features:
- Clean 3D rendering with proper lighting and shading
- Game-quality textures on clothing and accessories
- Smooth, polished 3D surfaces
- Studio lighting with rim light for character separation
- Transparent or gradient background typical of game character showcases
- High polygon quality, no visible mesh artifacts
- Realistic material shaders (metallic, fabric, leather, etc.)`,

    'realistic': `[STYLE — PHOTOREALISTIC]
Transform the character into a photorealistic human photograph, as if this game 
character were a real person in a professional photo shoot. Features:
- Real human skin texture with pores, subtle imperfections
- Real fabric textures on clothing (cotton, leather, nylon, etc.)
- Natural lighting (studio or outdoor)
- Photographic depth of field
- Real hair with individual strand detail
- Realistic eye reflections and moisture
- Professional photography quality (8K, sharp focus)`,

    'semi_realistic': `[STYLE — SEMI-REALISTIC]
Create a semi-realistic rendering that blends game character aesthetics with 
photorealistic elements. Features:
- Slightly stylized proportions (larger eyes, smoother skin than real life)
- Real-world quality textures on clothing and accessories
- Cinematic lighting with dramatic contrast
- Detailed but slightly idealized skin
- A blend between CGI movie quality and game render
- High detail on accessories, weapons, and outfit elements`,

    'anime': `[STYLE — ANIME/ILLUSTRATION]
Transform the character into anime/manga illustration style. Features:
- Clean anime line art with cel shading
- Vibrant, saturated colors
- Anime-proportioned eyes and facial features
- Dynamic pose emphasis
- Clean background or speed lines
- Manga/anime coloring techniques`,
};

// =============================================================================
// OUTFIT CHANGE PROMPTS
// =============================================================================

/**
 * Build a prompt for changing character outfit
 * @param {string} outfitDescription - Description of the new outfit
 * @param {boolean} preserveFace - Whether to preserve face identity
 * @returns {string} Enhanced prompt
 */
function buildOutfitChangePrompt(outfitDescription, preserveFace = true) {
    const parts = [];
    
    if (preserveFace) {
        parts.push(FACE_CONSISTENCY_PROMPT);
    }
    
    parts.push(FF_CHARACTER_CONTEXT);
    
    parts.push(`[OUTFIT CHANGE INSTRUCTION]
Change ONLY the character's clothing/outfit to the following while keeping 
the character's face, body pose, body proportions, hair, and background 
COMPLETELY UNCHANGED:

New Outfit: ${outfitDescription}

Rules:
- The outfit must fit the character's body naturally
- Maintain proper cloth physics and draping
- Preserve all accessories unless specified to change
- Keep the same camera angle and framing
- The character's pose stays EXACTLY the same
- Clothing details should be high-quality and game-accurate`);

    return parts.join('\n\n');
}

// =============================================================================
// POSE CHANGE PROMPTS
// =============================================================================

/**
 * Build a prompt for changing character pose
 * @param {string} poseDescription - Description of the new pose
 * @param {boolean} preserveFace - Whether to preserve face identity
 * @returns {string} Enhanced prompt
 */
function buildPoseChangePrompt(poseDescription, preserveFace = true) {
    const parts = [];
    
    if (preserveFace) {
        parts.push(FACE_CONSISTENCY_PROMPT);
    }
    
    parts.push(FF_CHARACTER_CONTEXT);
    
    parts.push(`[POSE CHANGE INSTRUCTION]
Change the character's body pose to the following while keeping the character's 
identity, outfit, and visual style COMPLETELY UNCHANGED:

New Pose: ${poseDescription}

Rules:
- The character's face and identity must remain EXACTLY the same
- The outfit/clothing stays EXACTLY the same, just repositioned for the new pose
- Maintain proper anatomy and body proportions
- Natural weight distribution and balance
- Proper foreshortening if applicable
- Keep the same lighting style and background`);

    return parts.join('\n\n');
}

// =============================================================================
// STYLE TRANSFER PROMPTS
// =============================================================================

/**
 * Build a prompt for style transfer (3D, Realistic, etc.)
 * @param {string} style - Style key from STYLE_PROMPTS
 * @param {string} additionalInstructions - Extra instructions
 * @param {boolean} preserveFace - Whether to preserve face identity
 * @returns {string} Enhanced prompt
 */
function buildStyleTransferPrompt(style, additionalInstructions = '', preserveFace = true) {
    const parts = [];
    
    if (preserveFace) {
        parts.push(FACE_CONSISTENCY_PROMPT);
    }
    
    const stylePrompt = STYLE_PROMPTS[style] || STYLE_PROMPTS['3d_render'];
    parts.push(stylePrompt);
    
    parts.push(FF_CHARACTER_CONTEXT);
    
    if (additionalInstructions) {
        parts.push(`[ADDITIONAL INSTRUCTIONS]\n${additionalInstructions}`);
    }
    
    parts.push(`[CORE RULE] Transform the visual style as described above while 
keeping the character's identity, outfit design, and pose UNCHANGED.
The character must be immediately recognizable as the same person.`);

    return parts.join('\n\n');
}

// =============================================================================
// WORKFLOW NODE PROMPT BUILDER
// =============================================================================

/**
 * Build prompt from a workflow node configuration
 * @param {Object} nodeConfig - { type, outfit, pose, style, faceRef, customPrompt, ... }
 * @returns {string} Complete prompt for Gemini
 */
function buildWorkflowPrompt(nodeConfig) {
    const parts = [];
    const {
        type,
        outfit,
        pose,
        style,
        customPrompt,
        preserveFace = true,
        denoisingStrength,
        faceRefCount = 0,
    } = nodeConfig;

    // Face consistency (always first for maximum weight)
    if (preserveFace) {
        parts.push(FACE_CONSISTENCY_PROMPT);
        if (faceRefCount > 1) {
            parts.push(FACE_MULTI_ANGLE_PROMPT);
        }
    }

    // FF context
    parts.push(FF_CHARACTER_CONTEXT);

    // Style instruction
    if (style && STYLE_PROMPTS[style]) {
        parts.push(STYLE_PROMPTS[style]);
    }

    // Outfit instruction
    if (outfit) {
        parts.push(`[OUTFIT] Change the character's clothing to: ${outfit}
Keep the character's face, pose, body proportions UNCHANGED.
The outfit should fit naturally with proper cloth physics.`);
    }

    // Pose instruction
    if (pose) {
        parts.push(`[POSE] Change the character's pose to: ${pose}
Keep the character's face, identity, and outfit UNCHANGED.
Maintain proper anatomy and natural body mechanics.`);
    }

    // Denoising
    if (denoisingStrength !== undefined && denoisingStrength !== null) {
        parts.push(`[EDIT INTENSITY] ${getDenoisingPrompt(denoisingStrength)}`);
    }

    // Custom prompt (user's own text)
    if (customPrompt) {
        parts.push(customPrompt);
    }

    return parts.join('\n\n');
}

// =============================================================================
// SEED SIMULATION
// =============================================================================

function getSeedPrompt(seed) {
    if (seed === null || seed === undefined) return '';
    
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

// =============================================================================
// REGION MASKING
// =============================================================================

function getMaskRegionPrompt(mask) {
    if (!mask) return '';

    const { x, y, width, height, imageWidth, imageHeight } = mask;
    
    const centerX = (x + width / 2) / imageWidth;
    const centerY = (y + height / 2) / imageHeight;
    const relWidth = width / imageWidth;
    const relHeight = height / imageHeight;

    let horizontal, vertical;
    if (centerX < 0.33) horizontal = 'left';
    else if (centerX < 0.66) horizontal = 'center';
    else horizontal = 'right';

    if (centerY < 0.33) vertical = 'top';
    else if (centerY < 0.66) vertical = 'middle';
    else vertical = 'bottom';

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

// =============================================================================
// BUILD ENHANCED PROMPT (Legacy API - still works)
// =============================================================================

function buildEnhancedPrompt(userPrompt, params = {}) {
    const parts = [];

    if (params.identityLock) {
        parts.push(FACE_CONSISTENCY_PROMPT); // Upgraded to stronger version
    }

    if (params.texturePreservation) {
        parts.push(TEXTURE_PRESERVATION_PROMPT);
    }

    if (params.denoisingStrength !== undefined && params.denoisingStrength !== null) {
        parts.push(`[EDIT INTENSITY] ${getDenoisingPrompt(params.denoisingStrength)}`);
    }

    if (params.seed !== undefined && params.seed !== null) {
        const seedPrompt = getSeedPrompt(params.seed);
        if (seedPrompt) parts.push(seedPrompt);
    }

    if (params.mask) {
        parts.push(getMaskRegionPrompt(params.mask));
    }

    parts.push(userPrompt);

    return parts.join('\n\n');
}

function buildUpscalePrompt() {
    return `Upscale this image to the highest possible resolution and quality. 
Enhance all details, textures, and sharpness without changing any content, 
composition, colors, or style. The result should be a perfect high-resolution 
version of the exact same image.`;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    // Legacy
    getDenoisingPrompt,
    getSeedPrompt,
    getMaskRegionPrompt,
    buildEnhancedPrompt,
    buildUpscalePrompt,
    IDENTITY_LOCK_PROMPT,
    TEXTURE_PRESERVATION_PROMPT,
    
    // FreeFire Studio
    FACE_CONSISTENCY_PROMPT,
    FACE_MULTI_ANGLE_PROMPT,
    FF_CHARACTER_CONTEXT,
    STYLE_PROMPTS,
    buildOutfitChangePrompt,
    buildPoseChangePrompt,
    buildStyleTransferPrompt,
    buildWorkflowPrompt,
};
