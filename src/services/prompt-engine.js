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
Image 1 = FRONT view (primary identity reference)
Image 2 = SIDE/PROFILE view (nose bridge, jawline depth, ear position)
Image 3 = BACK/3-QUARTER view (hair from behind, head shape, neckline)
Use ALL reference angles to reconstruct the face accurately from the target viewpoint.
Cross-reference between angles to ensure EVERY facial feature is consistent across views.`;

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
// ANTI-DEGRADATION SYSTEM (v2.2)
// =============================================================================

const SINGLE_IMAGE_CONSTRAINT = `[STRICT OUTPUT FORMAT]
Generate EXACTLY ONE single image. Do NOT create multiple panels, collages, grid layouts,
or split views. Do NOT create comparison images or before/after layouts.
The output must be ONE continuous full-body character render on a single canvas.
If you generate more than one image or a collage, you have FAILED the task.`;

const POSE_LOCK_PROMPT = `[POSE PRESERVATION v3.0 — ABSOLUTE FREEZE]
⛔ THE CHARACTER'S POSE IS COMPLETELY FROZEN. DO NOT MODIFY IT UNDER ANY CIRCUMSTANCES.
This is NOT a full body re-render — this is a MICRO-EDIT targeting ONE specific body region.

FROZEN elements (MUST be pixel-identical to input):
- Body stance: feet position, leg spread, weight distribution
- Arm positions: shoulder angle, elbow bend, wrist rotation — EXACTLY AS INPUT
- Head angle: tilt, rotation, forward/backward lean — EXACTLY AS INPUT
- Camera perspective: distance, angle, height — UNCHANGED
- Canvas framing: crop, zoom level, character size in frame — UNCHANGED
- Aspect ratio: same pixel dimensions and proportions as input

If this micro-edit accidentally causes any limb, head, or body part to shift even 1 pixel
from its original position — YOU HAVE FAILED. Revert and only apply the requested change.
The pose is the FOUNDATION. Only the requested SINGLE item changes. Everything else is IDENTICAL.`;

const PIXEL_QUALITY_PROMPT = `[QUALITY — PIXEL FIDELITY v3.0]
The output image MUST maintain the same resolution and pixel quality as the input.
Do NOT downscale, add compression artifacts, blur, or soften the image.
Preserve sharp edges, clean anti-aliasing, and high-frequency details.
If the input is a high-res 3D game render, the output must be EQUALLY crisp and detailed —
do NOT flatten lighting, do NOT reduce polygon-level surface detail, do NOT smooth textures.
Do NOT introduce noise, grain, ringing, or any degradation not present in the original.
Match the input's sharpness level exactly.`;

const ASPECT_RATIO_LOCK_PROMPT = `[ASPECT RATIO — ABSOLUTE LOCK]
The output image MUST have the EXACT same aspect ratio as the input image.
Do NOT crop, letterbox, add black bars, zoom in, or zoom out.
If the input is portrait (e.g., 3:4 or 9:16), the output MUST be portrait with identical proportions.
If the input is square (1:1), the output MUST be square.
The character must occupy the same RELATIVE position and SIZE within the frame as in the input.
Do NOT re-crop or re-frame the character. Output dimensions = Input dimensions.`;

const PIXEL_RECOVERY_PROMPT = `[PIXEL RESTORATION — RECOVER FROM MULTI-EDIT DEGRADATION]
⚠️ IMPORTANT: The input image has undergone multiple AI editing passes and may have accumulated
compression artifacts, softness, or detail loss. Your job is to FIX THIS while applying the edit.

Restoration requirements:
- SHARPEN all edges: clothing seams, hair strands, accessory outlines
- RESTORE material texture detail: fabric weave, leather grain, metal reflections
- CLEAN UP compression artifacts: remove any jpeg-like blocking, noise, or halo rings
- ENHANCE color saturation back to game-quality vibrancy (match the original character's palette)
- RESTORE high-frequency detail: individual hair strands, stitch patterns, logo sharpness
Treat this as a RESTORATION + EDIT dual task. The output should look BETTER than the input.`;

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
- Realistic material shaders (metallic, fabric, leather, etc.)
STRICT: Output EXACTLY ONE single character render. NOT a collage, NOT 4 panels, NOT multiple views. ONE image.`,

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
    
    parts.push(POSE_LOCK_PROMPT);
    parts.push(SINGLE_IMAGE_CONSTRAINT);

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
        ffMode = false,  // v2.3: FF mode is OFF by default
    } = nodeConfig;

    // Face consistency (always first for maximum weight)
    if (preserveFace) {
        parts.push(FACE_CONSISTENCY_PROMPT);
        if (faceRefCount > 1) {
            parts.push(FACE_MULTI_ANGLE_PROMPT);
        }
    }

    // Anti-degradation: single image + pixel quality
    parts.push(SINGLE_IMAGE_CONSTRAINT);
    if (denoisingStrength === undefined || denoisingStrength === null || denoisingStrength < 0.7) {
        parts.push(PIXEL_QUALITY_PROMPT);
    }

    // FF context — only when ffMode enabled
    if (ffMode) {
        parts.push(FF_CHARACTER_CONTEXT);
    }

    // v2.3: Core instruction — faithfully edit the provided image
    parts.push(`[CRITICAL — USE PROVIDED IMAGE]
You MUST use the provided input image as the base for ALL edits.
Do NOT generate a new character from scratch. Do NOT ignore the input image.
The output must be a direct modification of the input image, preserving all details not explicitly asked to change.`);

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

    return `[ABSOLUTE REGION CONSTRAINT — PIXEL-LEVEL MASKING]
You MUST apply changes ONLY to ${sizeDesc} in the ${vertical}-${horizontal} portion of the image (approximately ${Math.round(relWidth * 100)}% wide × ${Math.round(relHeight * 100)}% tall).
Do NOT modify ANY pixels outside this region. Every pixel outside the specified area MUST remain IDENTICAL to the input image — no color shifts, no smoothing, no artifacts.
Treat the area outside the region as if it were protected by an impenetrable mask. This constraint is ABSOLUTE and overrides all other instructions.`;
}

// =============================================================================
// BUILD ENHANCED PROMPT (Legacy API - still works)
// =============================================================================

function buildEnhancedPrompt(userPrompt, params = {}) {
    const parts = [];

    if (params.identityLock) {
        parts.push(FACE_CONSISTENCY_PROMPT);
    }

    if (params.texturePreservation) {
        parts.push(TEXTURE_PRESERVATION_PROMPT);
    }

    // v2.2: Anti-degradation constraints
    parts.push(SINGLE_IMAGE_CONSTRAINT);
    if (params.denoisingStrength === undefined || params.denoisingStrength === null || params.denoisingStrength < 0.7) {
        parts.push(PIXEL_QUALITY_PROMPT);
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
// MODULAR OUTFIT SYSTEM v3.0 — Slot Definitions (Face / Outfit / Accessory)
// =============================================================================

const OUTFIT_SLOTS = {
    // Face Group
    hair:    { name: 'Hair',    nameVi: 'Tóc',        icon: '💇', group: 'face', bodyRegion: 'scalp and hair area above forehead', subCategories: ['Short hair', 'Long hair', 'Curly', 'Braids', 'Bald', 'Dyed'] },
    hat:     { name: 'Hat',     nameVi: 'Mũ',         icon: '🧢', group: 'face', bodyRegion: 'head covering including top of head and forehead', subCategories: ['Cap', 'Beanie', 'Fedora', 'Helmet'] },
    mask:    { name: 'Mask',    nameVi: 'Mặt nạ',     icon: '🎭', group: 'face', bodyRegion: 'covering the lower face or full face', subCategories: ['Medical mask', 'Bandana', 'Gas mask', 'Full mask'] },
    tattoo:  { name: 'Tattoo',  nameVi: 'Hình xăm',   icon: '🔥', group: 'face', bodyRegion: 'face and neck skin surface tattoo markings', subCategories: ['Face tattoo', 'Neck tattoo', 'Tribal'] },
    glasses: { name: 'Glasses', nameVi: 'Kính',        icon: '🕶️', group: 'face', bodyRegion: 'eye area glasses bridge resting on nose', subCategories: ['Sunglasses', 'Reading glasses', 'Aviator', 'Goggles'] },
    earring: { name: 'Earring', nameVi: 'Khuyên tai',  icon: '💎', group: 'face', bodyRegion: 'earlobe and ear cartilage area', subCategories: ['Stud', 'Hoop', 'Drop', 'Cuff'] },
    beard:   { name: 'Beard',   nameVi: 'Râu',         icon: '🧔', group: 'face', bodyRegion: 'lower face chin jawline upper lip cheeks', subCategories: ['Full beard', 'Goatee', 'Stubble', 'Mustache'] },
    // Outfit Group
    top_inner: { name: 'Inner Top',  nameVi: 'Áo trong',     icon: '👕', group: 'outfit', bodyRegion: 'torso innermost layer shirt closest to body', subCategories: ['T-shirt', 'Tank top', 'Undershirt'] },
    top_outer: { name: 'Outer Top',  nameVi: 'Áo ngoài',     icon: '🧥', group: 'outfit', bodyRegion: 'torso outer layer over inner shirt', subCategories: ['Button-up', 'Sweater', 'Hoodie', 'Vest'] },
    jacket:    { name: 'Jacket',     nameVi: 'Áo khoác',     icon: '🧥', group: 'outfit', bodyRegion: 'outermost torso layer coat jacket blazer', subCategories: ['Leather jacket', 'Bomber', 'Trench coat', 'Blazer'] },
    bottom:    { name: 'Bottom',     nameVi: 'Quần',          icon: '👖', group: 'outfit', bodyRegion: 'from waist to ankles covering legs and hip area', subCategories: ['Pants', 'Shorts', 'Tactical trousers', 'Joggers'] },
    skirt:     { name: 'Skirt',      nameVi: 'Váy',           icon: '👗', group: 'outfit', bodyRegion: 'from waist downward skirt dress lower portion', subCategories: ['Mini skirt', 'Midi', 'Maxi', 'Pleated'] },
    stockings: { name: 'Stockings',  nameVi: 'Tất',           icon: '🧦', group: 'outfit', bodyRegion: 'legs from ankle to upper thigh hosiery area', subCategories: ['Knee socks', 'Thigh highs', 'Tights'] },
    footwear:  { name: 'Footwear',   nameVi: 'Giày',          icon: '👟', group: 'outfit', bodyRegion: 'feet and ankle area from ankle down', subCategories: ['Sneakers', 'Boots', 'Combat boots', 'High heels'] },
    onepiece:  { name: 'One-Piece',  nameVi: 'Bộ liền thân',  icon: '👗', group: 'outfit', bodyRegion: 'entire body from shoulders to legs as one garment', subCategories: ['Dress', 'Jumpsuit', 'Bodysuit', 'Gown'] },
    // Accessory Group
    gloves:   { name: 'Gloves',   nameVi: 'Bao tay',     icon: '🧤', group: 'accessory', bodyRegion: 'hands and wrists from fingertips to forearm', subCategories: ['Fingerless', 'Full gloves', 'Tactical', 'Leather'] },
    scarf:    { name: 'Scarf',    nameVi: 'Khăn quàng',  icon: '🧣', group: 'accessory', bodyRegion: 'neck and upper chest area draped around shoulders', subCategories: ['Scarf', 'Shawl', 'Bandana', 'Necktie'] },
    belt:     { name: 'Belt',     nameVi: 'Thắt lưng',   icon: '⚡', group: 'accessory', bodyRegion: 'waist area between top and bottom garments', subCategories: ['Leather belt', 'Tactical belt', 'Chain belt', 'Utility belt'] },
    necklace: { name: 'Necklace', nameVi: 'Vòng cổ',    icon: '📿', group: 'accessory', bodyRegion: 'around the neck resting on the upper chest', subCategories: ['Chain', 'Choker', 'Pendant'] },
    bracelet: { name: 'Bracelet', nameVi: 'Vòng tay',    icon: '⌚', group: 'accessory', bodyRegion: 'around the wrists', subCategories: ['Bangle', 'Watch', 'Beaded'] },
    // Legacy compat
    head: { name: 'Head', nameVi: 'Đầu', icon: '🎩', group: 'face', bodyRegion: 'above the neckline covering skull and hair', subCategories: ['Hair', 'Hats', 'Helmets'], _legacy: true },
    face: { name: 'Face', nameVi: 'Mặt', icon: '🕶️', group: 'face', bodyRegion: 'facial area from forehead to chin', subCategories: ['Glasses', 'Masks'], _legacy: true },
    top:  { name: 'Top',  nameVi: 'Áo',  icon: '👕', group: 'outfit', bodyRegion: 'torso from shoulders to waist', subCategories: ['Shirts', 'Jackets'], _legacy: true },
};

// Per-slot feature extraction templates (v4.0 — ZONE-LOCKED + FF 3D STYLE)
const SLOT_EXTRACTION_PROMPTS = {
    // Face Group
    hair: `[SLOT: HAIR — COLOR-STRICT | ZONE: SCALP ONLY]
Look at the reference image and extract the EXACT: hair style, length, texture, volume, parting.
CRITICAL COLOR MATCH: The hair color MUST be PIXEL-IDENTICAL to the reference. If reference hair is blonde, output MUST be blonde — NOT brown, NOT black.
Do NOT reinterpret the hairstyle — copy it exactly as shown.
⛔ ZONE LOCK: ONLY modify the scalp/hair area. Do NOT change face, clothing, body pose, or any other region.`,

    hat: `[SLOT: HAT — DETAIL-STRICT | ZONE: HEAD/FOREHEAD]
Extract from reference: hat type, material, color, logos, and structure.
CRITICAL DETAIL MATCH: The headwear MUST be 95% IDENTICAL to the reference image in terms of texture and shape.
⛔ ZONE LOCK: ONLY add/change the hat on top of the head/hair. Do NOT alter face identity, lower face, or clothing.`,

    mask: `[SLOT: MASK — DETAIL-STRICT | ZONE: FACE COVERING]
Extract from reference: mask type (medical, bandana, half-face etc.), material, color, straps, details.
CRITICAL DETAIL MATCH: The mask MUST be 95% IDENTICAL to the reference image.
⛔ ZONE LOCK: ONLY modify the lower face or full face (as shown). Do NOT change upper face (if lower mask), hair, clothing, or body pose.`,

    tattoo: `[SLOT: TATTOO — COLOR-STRICT | ZONE: FACE/NECK SKIN ONLY]
Extract the EXACT tattoo from the reference: pattern, line thickness, shading, placement on face/neck, ink color.
Reproduce the tattoo IDENTICALLY — same position, same size, same design. Do NOT create a different tattoo.
⛔ ZONE LOCK: Apply ONLY to face/neck SKIN surface. Do NOT place on clothing, arms, or body. Do NOT change any clothing layer.`,

    glasses: `[SLOT: GLASSES — DETAIL-STRICT | ZONE: EYE BRIDGE ONLY]
Extract from reference: frame shape, frame color, lens tint, style (aviator/round/sport/cat-eye).
CRITICAL DETAIL MATCH: The eyewear MUST be 95% IDENTICAL to the reference. Match exact frame thickness, exact bridge design, and exact colors.
⛔ ZONE LOCK: ONLY add/change eyewear on the nose bridge/eye area. Do NOT alter face identity, hair, clothing, or body pose.`,

    earring: `[SLOT: EARRING — DETAIL-STRICT | ZONE: EARLOBES ONLY]
Extract: earring type (stud/hoop/drop/cuff), material (gold/silver/crystal), EXACT color, size.
CRITICAL DETAIL MATCH: The earring MUST be 95% IDENTICAL to the reference image.
⛔ ZONE LOCK: ONLY modify the earlobe area. Do NOT change face, hair, clothing, or body pose.`,

    beard: `[SLOT: BEARD — COLOR-STRICT | ZONE: LOWER FACE ONLY]
Extract: facial hair style, density, shape, EXACT color. Apply the exact beard/mustache from reference.
⛔ ZONE LOCK: ONLY modify the chin, jawline, upper lip, and cheeks. Do NOT change eyes, nose, hair, clothing, or body pose.`,

    // Outfit Group
    top_inner: `[SLOT: INNER TOP — COLOR-STRICT | ZONE: TORSO INNER LAYER]
Look at the reference image carefully. Extract the EXACT:
- Garment type: T-shirt / tank top / undershirt / crop top
- COLOR: Match the EXACT color from reference — if it's RED, output MUST be RED, NOT dark/black/brown
- Pattern: solid / striped / graphic / logo — reproduce EXACTLY as shown
- Neckline shape, sleeve length, fit (tight/loose)
This is the innermost body layer. RENDER IN 3D GAME STYLE (FreeFire quality PBR textures, NOT photorealistic).
⛔ ZONE LOCK: ONLY modify the torso/chest area for this inner garment. Do NOT change pants, shoes, face, hair, accessories, or body pose.`,

    top_outer: `[SLOT: OUTER TOP — COLOR-STRICT | ZONE: TORSO OUTER LAYER]
Look at the reference image carefully. Extract the EXACT:
- Garment type: button-up / sweater / hoodie / vest / polo
- COLOR: Match the EXACT color — do NOT darken, do NOT shift hue
- Pattern/texture: reproduce ANY prints, logos, stripes, graphics EXACTLY
- This layer sits OVER the inner top. Show proper layering at collar/sleeves/hem.
RENDER IN 3D GAME STYLE (FreeFire quality PBR textures, NOT photorealistic).
⛔ ZONE LOCK: ONLY modify the torso area for this outer garment. Do NOT change pants, shoes, face, accessories, or body pose.`,

    jacket: `[SLOT: JACKET — COLOR-STRICT | ZONE: TORSO OUTERMOST LAYER]
Look at the reference image carefully. Extract the EXACT:
- Jacket type: leather / bomber / trench / blazer / denim / windbreaker
- COLOR: Match the EXACT color — a RED jacket MUST stay RED, NOT become dark/black
- Material appearance: game-quality PBR leather sheen, fabric texture, zipper/button details
- Logos, patches, embroidery: reproduce EXACTLY in correct position
This is the OUTERMOST layer. Show proper layering over inner layers.
RENDER IN 3D GAME STYLE (FreeFire quality, NOT photorealistic).
⛔ ZONE LOCK: ONLY modify the outermost torso layer. Do NOT change pants, shoes, face, hair, scarf, or body pose. Items underneath (inner shirt, scarf etc) keep their EXISTING shape.`,

    bottom: `[SLOT: BOTTOM — COLOR-STRICT | ZONE: WAIST TO ANKLES]
Look at the reference image carefully. Extract the EXACT:
- Type: pants / shorts / joggers / tactical trousers / cargo
- COLOR: Match the EXACT color from reference — if it's BLUE jeans, output MUST be BLUE, NOT black
- Pattern: solid / camo / plaid / distressed — reproduce EXACTLY  
- Fit: skinny / regular / baggy / cargo pockets
- Details: belt loops, pockets, cuffs, rips/distressing
RENDER IN 3D GAME STYLE (FreeFire quality PBR textures).
⛔ ZONE LOCK: ONLY modify the area from waist to ankles. Do NOT change shoes, upper body clothing, face, hair, or body pose. Stockings/socks that are already rendered UNDERNEATH must remain unchanged.`,

    skirt: `[SLOT: SKIRT — COLOR-STRICT | ZONE: WAIST DOWNWARD]
Look at the reference image carefully. Extract the EXACT:
- Type: pleated / A-line / mini / midi / pencil / flared
- COLOR: Match the EXACT color — SOLID PINK stays SOLID PINK
- Pattern: ONLY use the pattern shown in reference
- Material: cotton / chiffon / leather / denim
- Length and pleating style
RENDER IN 3D GAME STYLE (FreeFire quality PBR textures).
⛔ ZONE LOCK: ONLY modify from waist downward. Do NOT change top, shoes, face, hair, or body pose.`,

    stockings: `[SLOT: STOCKINGS — COLOR-STRICT | ZONE: LEGS ONLY | LENGTH-STRICT]
Look at the reference image carefully. Extract the EXACT:
- Type: ankle socks / knee socks / thigh highs / full tights / leg warmers
- LENGTH: This is CRITICAL — if the reference shows SHORT ANKLE SOCKS, you MUST render SHORT ANKLE SOCKS. Do NOT extend them to knee-high or thigh-high. If the reference shows KNEE SOCKS, render exactly to the knee, NOT higher or lower.
- COLOR: Match the EXACT color and pattern (stripes, solid, etc)
- Opacity: sheer / opaque / semi-transparent as shown in reference
RENDER IN 3D GAME STYLE (FreeFire quality, NOT photorealistic).
⛔ ZONE LOCK: ONLY modify the leg area where stockings/socks appear. Do NOT change shoes, pants, upper body, face, or body pose. The stocking length MUST match the reference image EXACTLY — do NOT make them longer or shorter.`,

    footwear: `[SLOT: FOOTWEAR — DETAIL-STRICT | ZONE: FEET AND ANKLES ONLY]
Look at the reference image carefully. Extract the EXACT:
- Type: sneakers / boots / heels / sandals / combat boots
- COLOR: Match EXACT colors — white shoes stay white, red stays red
- Details: laces, buckles, metallic hardware, soles thickness, brand logos/stripes
RENDER IN 3D GAME STYLE (FreeFire quality PBR textures).
⛔ ZONE LOCK: ONLY modify the feet and ankle area from ankle downward. Do NOT change stockings, pants, upper body, face, or body pose.`,

    onepiece: `[SLOT: ONE-PIECE — COLOR-STRICT | ZONE: SHOULDERS TO LEGS]
Look at the reference image carefully. Extract the EXACT:
- Type: dress / jumpsuit / bodysuit / gown / romper
- COLOR: Match the EXACT color and any gradient/ombre effects
- Pattern: solid / floral / geometric — reproduce EXACTLY from reference
- Neckline, sleeve type, length, material
This covers BOTH upper and lower body as one piece. Skip separate top/bottom.
RENDER IN 3D GAME STYLE (FreeFire quality PBR textures).
⛔ ZONE LOCK: Covers shoulders to legs as one piece. Do NOT change face, hair, shoes, or body pose.`,

    // Accessory Group
    necklace: `[SLOT: NECKLACE — DETAIL-STRICT | ZONE: NECK/UPPER CHEST ONLY]
Extract from reference: chain type (thin/thick/rope/box/etc), pendant shape, EXACT material (gold/silver/platinum), exact colors.
CRITICAL: Reproduce the exact necklace 95% identical to reference.
RENDER IN 3D GAME STYLE — the necklace must look like a FreeFire game asset with PBR metallic shaders, NOT a real photograph.
⛔ ZONE LOCK: ONLY add the necklace around the neck/upper chest area. Do NOT change ANY clothing layers, face, hair, pose, or other accessories. The necklace sits ON TOP of whatever shirt/jacket is already there.`,

    bracelet: `[SLOT: BRACELET — DETAIL-STRICT | ZONE: WRISTS ONLY]
Extract from reference: bracelet/watch type, band/strap material, EXACT color and design.
CRITICAL: The bracelet MUST be 95% IDENTICAL to the reference.
RENDER IN 3D GAME STYLE — must look like a FreeFire game asset with PBR metallic/leather shaders, NOT a real photograph.
⛔ ZONE LOCK: ONLY add the bracelet to the wrist area. Do NOT change ANY clothing layers, gloves, face, hair, or body pose.`,

    gloves: `[SLOT: GLOVES — DETAIL-STRICT | ZONE: HANDS/WRISTS ONLY]
Extract: glove type, coverage (fingerless/full/tactical), EXACT material and color from reference.
CRITICAL: The gloves MUST be 95% IDENTICAL to the reference. Copy every strap, pad, and buckle.
RENDER IN 3D GAME STYLE (FreeFire quality PBR textures).
⛔ ZONE LOCK: ONLY modify hands and wrists. Do NOT change arms, clothing, face, or body pose.`,

    scarf: `[SLOT: SCARF — DETAIL-STRICT | ZONE: NECK/SHOULDERS ONLY]
Extract: scarf/shawl/bandana type, draping style, EXACT color and pattern from reference.
CRITICAL: Reproduce the exact physical draping 95% identical to reference.
MUST BE RENDERED IN 3D GAME STYLE — the scarf texture must look like a FreeFire game asset with clean 3D fabric shading and PBR material. Do NOT render as a photorealistic fabric photograph.
⛔ ZONE LOCK: ONLY add/modify the scarf around neck/shoulder area. Do NOT change jacket shape, shirt, face, hair, or body pose. If a jacket is already rendered over the scarf, the scarf must appear UNDER the jacket's collar/lapels — do NOT reshape the jacket.`,

    belt: `[SLOT: BELT — DETAIL-STRICT | ZONE: WAISTLINE ONLY]
Extract: belt type, width, buckle style, hardware (chains/rings), EXACT material and color.
CRITICAL: The belt and buckle MUST be 95% IDENTICAL to the reference.
RENDER IN 3D GAME STYLE (FreeFire quality PBR hardware/leather).
⛔ ZONE LOCK: ONLY add/modify the belt at the waistline area. Do NOT change pants, shirt, jacket, face, or body pose.`,

    // Legacy
    head: `[SLOT: HEAD — DETAIL-STRICT] Extract: hair style, headwear type. Match EXACT colors and 95% of all details. ⛔ ZONE LOCK: HEAD ONLY.`,
    face: `[SLOT: FACE — DETAIL-STRICT] Extract: glasses, makeup, masks. Match EXACT details. ⛔ ZONE LOCK: FACE ONLY.`,
    top: `[SLOT: TOP — COLOR-STRICT] Extract: upper body garment type, EXACT colors, patterns, materials. ⛔ ZONE LOCK: TORSO ONLY.`,
};

// =============================================================================
// FREEFIRE STYLE CONSISTENCY — Transform any input to FF 3D style
// =============================================================================

const FF_STYLE_CONSISTENCY_PROMPT = `[CRITICAL — GAME STYLE CONSISTENCY]
ALL outfit components MUST be rendered in FreeFire's signature 3D game style, regardless of the input reference image style.
If the reference image shows a real-life photograph or anime drawing:
- Transform the clothing design INTO FreeFire's 3D rendering style
- Apply game-quality material shaders: PBR metallic, fabric subsurface, leather gloss
- Use FreeFire's characteristic lighting: strong rim light, ambient occlusion, soft fill
- Maintain the DESIGN of the reference outfit but CONVERT the rendering style
- Textures should look like high-poly game asset textures, not photographs
- Colors should be slightly more saturated and vibrant than real life
- IMPORTANT: This applies to ALL items including scarves, necklaces, bracelets, belts — every accessory must look like a 3D game item, NOT a real-world photograph
The final output must look like an official FreeFire character render, NOT a photo edit.`;

// =============================================================================
// INCREMENTAL RENDERING — Single-slot addition to previously rendered image
// =============================================================================

const INCREMENTAL_MODE_PROMPT = `[CRITICAL — INCREMENTAL EDIT MODE]
The base image you are given ALREADY has previously applied outfit items rendered on it.
You MUST treat these existing items as PERMANENT and IMMUTABLE.

RULES:
1. Do NOT re-render, reshape, or modify ANY clothing/accessory that is already visible on the character
2. Do NOT change the character's body pose, stance, arm position, or leg position under ANY circumstances
3. ONLY add/modify the ONE specific slot described below — nothing else
4. The existing outfit items (shirts, pants, jackets, scarves, etc) on the base image are FINAL — preserve them pixel-perfectly
5. Only change the pixels in the body region specified by the target slot
6. If the new item overlaps with existing items, layer it naturally (e.g., belt over pants, scarf under jacket collar)
7. Maintain the EXACT same art style, lighting, and rendering quality as the existing base image`;

// =============================================================================
// BODY ANATOMY MAPPING — Ensure outfits fit the pose model
// =============================================================================

const BODY_ANATOMY_PROMPT = `[BODY ANATOMY CONSTRAINT]
The outfit components MUST conform to the character's body anatomy:
- Shoulder width and arm length determine sleeve fit
- Torso proportions (chest, waist, hips) determine top/bottom draping
- Leg length and stance determine pant/skirt fall and shoe positioning
- The character's current POSE must be maintained exactly
- Cloth physics should respond naturally to the pose (gravity, tension, compression)
- No clipping through body parts — garments must wrap around the body naturally
- Proper layering: inner garments under outer garments, no Z-fighting appearance
Use the provided character image as the absolute body reference for fitting.`;

const BODY_TYPE_PROMPTS = {
    standard: 'Standard game character proportions with balanced build.',
    athletic: 'Athletic build with broader shoulders, defined muscles, narrow waist.',
    slim: 'Slim/lean build with narrower frame and lighter musculature.',
    heavy: 'Heavier build with wider frame and more body mass.',
};

// =============================================================================
// ONE-PIECE OUTFIT — Dresses, suits, jumpsuits
// =============================================================================

const ONE_PIECE_PROMPT = `[ONE-PIECE GARMENT MODE]
This outfit is a ONE-PIECE garment (dress, jumpsuit, full suit, or gown) that covers BOTH the upper and lower body as a single continuous piece.
- Do NOT separate top and bottom — treat as one unified garment
- The garment flows continuously from shoulders/neckline down to legs/feet
- Maintain natural draping and fabric flow for the full length
- Belt or waist details should be part of the single garment, not a separate piece
- The bottom slot is SKIPPED — the top description covers the entire outfit`;

// =============================================================================
// MULTI-VIEW PROMPTS
// =============================================================================

// =============================================================================
// MULTI-VIEW PROMPTS (Phase 2 - 5 Views Strip)
// =============================================================================

const MULTI_VIEW_LIGHTING_CONSTRAINT = `[CRITICAL — UNIFORM FLAT LIGHTING]
- Use PERFECTLY FLAT, EVEN lighting with ZERO directional shadows, ZERO rim lights, and ZERO specular highlights.
- The lighting must be identical to a 3D viewport with ambient-only illumination — no light source direction.
- Every surface should be lit uniformly as if in a light box. This ensures all 4 angles look consistent.
- DO NOT add dramatic lighting, studio key lights, or any lighting that differs from the base image.
- The texture shading should come ONLY from the material's baked textures, NOT from scene lighting.`;

const MULTI_VIEW_PROMPTS = {
    a_front: `[CAMERA PERSPECTIVE — A-POSE FRONT VIEW]
Render the exact same character standing in a strict A-POSE facing DIRECTLY toward the camera.
- A-POSE STRICT REQUIREMENT: The character must stand completely straight, legs slightly apart, with both arms hanging down and angled slightly outward from the body (like an 'A' shape).
- Full body visible from head to feet.
- Symmetrical framing — the character's LEFT arm appears on the RIGHT side of the image, and vice versa.
- The background MUST be a solid neutral gray (#808080) color.
[CRITICAL TEXTURE FIX]: You MUST preserve the EXACT rendering quality, material textures, and 3D lighting of the original image. Do NOT flatten or simplify the textures!`,

    a_back: `[CAMERA PERSPECTIVE — A-POSE REAR/BACK VIEW]
Rotate the camera 180 degrees to show the character's BACK.
Render the exact same character standing in a strict A-POSE with their BACK facing DIRECTLY toward the camera.
- The viewer sees the character's spine, back of the head/hair, and the rear of all clothing.
- A-POSE STRICT REQUIREMENT: Stand completely straight, legs slightly apart, arms angled slightly outward (A-shape). The character faces AWAY.
- Show ALL back details clearly: back of hair, jacket/shirt back panel, rear pockets of pants, shoe heels, belt from behind.
- The character's face must NOT be visible at all — not even a partial profile. Only the back of the head.
- The background MUST be a solid neutral gray (#808080) color.
${MULTI_VIEW_LIGHTING_CONSTRAINT}`,

    a_side_right: `[CAMERA PERSPECTIVE — STRICT 90° RIGHT PROFILE]
Rotate the camera exactly 90 degrees to show the character's RIGHT SIDE.
Render the exact same character standing in a strict A-POSE viewed from the RIGHT SIDE (the character's right shoulder faces the camera).
- CAMERA LOCK: The camera is perpendicular to the character's right side — exactly 90 degrees, orthographic-style.
- VISIBLE BODY PARTS: You see the character's RIGHT arm, RIGHT leg, RIGHT side of the face (right eye, right ear). The LEFT arm and LEFT leg are hidden behind the body.
- The character's nose points to the LEFT side of the image (away from the viewer).
- DO NOT use a 3/4 angle — this must be a pure 90° side silhouette.
- The background MUST be a solid neutral gray (#808080) color.
${MULTI_VIEW_LIGHTING_CONSTRAINT}`,

    a_side_left: `[CAMERA PERSPECTIVE — STRICT 90° LEFT PROFILE (MIRRORED)]
Rotate the camera exactly 90 degrees to the OTHER side to show the character's LEFT SIDE.
Render the exact same character standing in a strict A-POSE viewed from the LEFT SIDE (the character's left shoulder faces the camera).
- CAMERA LOCK: The camera is perpendicular to the character's left side — exactly 90 degrees, orthographic-style.
- VISIBLE BODY PARTS: You see the character's LEFT arm, LEFT leg, LEFT side of the face (left eye, left ear). The RIGHT arm and RIGHT leg are hidden behind the body.
- The character's nose points to the RIGHT side of the image (away from the viewer).
- This is a MIRROR of the right profile — the character faces the OPPOSITE direction compared to the right profile view.
- DO NOT use a 3/4 angle — this must be a pure 90° side silhouette.
- The background MUST be a solid neutral gray (#808080) color.
${MULTI_VIEW_LIGHTING_CONSTRAINT}`,
};

// =============================================================================
// MODULAR PROMPT BUILDERS
// =============================================================================

/**
 * Build a prompt for a single outfit component slot
 * @param {string} slot - 'head' | 'face' | 'top' | 'bottom' | 'footwear'
 * @param {string} description - User's description of the desired component
 * @param {number} referenceImageCount - Number of reference images for this slot
 * @param {Object} options - { preserveFace, bodyType, style }
 * @returns {string} Slot-specific prompt segment
 */
function buildComponentPrompt(slot, description, referenceImageCount = 0, options = {}, slotOverride = null) {
    const slotDef = OUTFIT_SLOTS[slot];
    if (!slotDef) return '';

    const parts = [];

    parts.push(`[COMPONENT: ${slotDef.name.toUpperCase()} — ${slotDef.nameVi}]`);
    parts.push(`Body region: ${slotDef.bodyRegion}`);
    parts.push(`Possible items: ${slotDef.subCategories.join(', ')}`);

    if (referenceImageCount > 0) {
        // Use slot override from Flow Editor if available, otherwise use default
        parts.push(slotOverride || SLOT_EXTRACTION_PROMPTS[slot]);
        parts.push(`${referenceImageCount} reference image(s) provided for this slot.`);
        parts.push('Extract the design from the reference and apply it to this slot.');
    }

    if (description) {
        parts.push(`\nDesired ${slotDef.name}: ${description}`);
    }

    return parts.join('\n');
}

/**
 * Build a complete modular outfit prompt from multiple component slots
 * @param {Object} components - { head: {desc, refCount}, face: {...}, top: {...}, bottom: {...}, footwear: {...} }
 * @param {Object} options - { preserveFace, isOnePiece, bodyType, style, denoisingStrength, faceRefCount }
 * @returns {string} Complete prompt for Gemini
 */
function buildModularOutfitPrompt(components, options = {}) {
    const {
        preserveFace = true,
        isOnePiece = false,
        bodyType = 'standard',
        style,
        denoisingStrength,
        faceRefCount = 0,
        anatomyData,
        ffMode = false,
        layerOrder,
        promptOverrides = {},   // <-- NEW: Flow Editor overrides
    } = options;

    const parts = [];

    // Helper: use override if available, otherwise use hardcoded constant
    const getPrompt = (key, fallback) => promptOverrides[key] || fallback;

    // Face consistency (highest priority — always first)
    if (preserveFace) {
        parts.push(getPrompt('FACE_CONSISTENCY', FACE_CONSISTENCY_PROMPT));
        if (faceRefCount > 1) {
            parts.push(FACE_MULTI_ANGLE_PROMPT);
        }
    }

    // v2.3: FF context only when enabled
    if (ffMode) {
        parts.push(FF_CHARACTER_CONTEXT);
        parts.push(getPrompt('FF_STYLE', FF_STYLE_CONSISTENCY_PROMPT));
    }

    // Framing Lock
    parts.push(getPrompt('FRAMING_LOCK', `[CRITICAL — USE PROVIDED IMAGE CONTEXT AND FRAMING]
You MUST use the provided [BASE CHARACTER IMAGE] as your exact canvas.
- DO NOT generate a new character from scratch.
- The output MUST maintain the EXACT same crop, frame, zoom level, camera distance, and dimension as the base image.
- If the base image is a full body, the output MUST be perfectly full body. DO NOT ZOOM IN on the clothing or character torso.`));

    // Aspect ratio lock (v3.0)
    parts.push(ASPECT_RATIO_LOCK_PROMPT);

    // Pixel recovery if requested (v3.0)
    if (options.pixelRecovery) {
        parts.push(PIXEL_RECOVERY_PROMPT);
    }

    // Body anatomy constraints
    parts.push(getPrompt('BODY_ANATOMY', BODY_ANATOMY_PROMPT));
    if (BODY_TYPE_PROMPTS[bodyType]) {
        parts.push(`[BODY TYPE] ${BODY_TYPE_PROMPTS[bodyType]}`);
    }

    // Style override
    if (style && STYLE_PROMPTS[style]) {
        parts.push(STYLE_PROMPTS[style]);
    }

    // One-piece mode
    if (isOnePiece) {
        parts.push(ONE_PIECE_PROMPT);
    }

    // ═══ NEW: Color & Pattern Preservation (fixes red→black issue) ═══
    parts.push(getPrompt('COLOR_PRESERVE', `[CRITICAL — COLOR & PATTERN FIDELITY]
When a reference image is provided for any outfit slot:
- Match the EXACT colors from the reference: hue, saturation, brightness must be preserved accurately
- RED must stay RED — do NOT shift to black, dark brown, or maroon
- WHITE must stay WHITE — do NOT shift to gray or cream
- Preserve ALL patterns: stripes, logos, prints, embroidery, graphic elements, textures
- If the reference has a graphic/logo/text, reproduce it faithfully in the correct position and scale
- Material appearance must match the reference: shiny stays shiny, matte stays matte, glossy stays glossy
- Do NOT apply artistic reinterpretation of colors — keep them EXACT as shown in the reference image
- When in doubt about a color, ALWAYS choose the brighter/more saturated version that matches the reference`));

    // Main outfit instruction header
    parts.push(getPrompt('OUTFIT_HEADER', `[MODULAR OUTFIT CHANGE & ANTI-BLEEDING]
Change the character's outfit using the following component specifications.
Each component targets a specific body region. Apply ALL active components simultaneously.

[CRITICAL ANTI-BLEEDING RULES]:
1. PREVENT CONCEPT BLEED: Do NOT mix elements between body parts!
2. If the character has a face or neck tattoo, it MUST stay on their skin. Do NOT draw the tattoo pattern onto their clothing or T-shirt.
3. Keep the character's face, identity (including existing facial tattoos/markings), body pose, proportions, background, and camera zoom/framing COMPLETELY UNCHANGED.`));

    // Add each active slot
    const defaultSlotOrder = Object.keys(OUTFIT_SLOTS).filter(k => !OUTFIT_SLOTS[k]._legacy);
    const slotOrder = (options.layerOrder && options.layerOrder.length > 0) 
        ? options.layerOrder 
        : defaultSlotOrder;
    let activeSlots = 0;

    // v3.0: If layer order is user-defined, add layering instruction
    if (options.layerOrder && options.layerOrder.length > 1) {
        const layerNames = options.layerOrder
            .filter(s => components[s] && (components[s].description || components[s].refCount))
            .map((s, i) => `${i + 1}. ${(OUTFIT_SLOTS[s] || {}).nameVi || s}`)
            .join(', ');
        if (layerNames) {
            parts.push(`[LAYER ORDER — User-defined stacking order, bottom to top]\n${layerNames}\nRespect this layering: items listed later appear ON TOP of earlier items visually.`);
        }
    }

    for (const slot of slotOrder) {
        if (isOnePiece && (slot === 'bottom' || slot === 'skirt')) continue;
        const comp = components[slot];
        if (!comp || (!comp.description && !comp.refCount)) continue;

        const label = (isOnePiece && (slot === 'top' || slot === 'top_inner' || slot === 'onepiece')) 
            ? `${slot} (ONE-PIECE / Full Body)` : slot;

        // Check for slot-specific prompt override from Flow Editor
        const slotOverride = (promptOverrides.SLOT_OVERRIDES && promptOverrides.SLOT_OVERRIDES[slot]) || null;

        const slotPrompt = buildComponentPrompt(
            slot,
            comp.description || '',
            comp.refCount || 0,
            options,
            slotOverride
        );

        if (slotPrompt) {
            parts.push(`\n--- SLOT: ${label.toUpperCase()} ---`);
            parts.push(slotPrompt);
            activeSlots++;
        }
    }

    if (activeSlots === 0) {
        parts.push('\n[NOTE] No specific component changes requested. Maintain current outfit.');
    }

    // Denoising
    if (denoisingStrength !== undefined && denoisingStrength !== null) {
        parts.push(`[EDIT INTENSITY] ${getDenoisingPrompt(denoisingStrength)}`);
    }

    // Final coherence instruction
    parts.push(getPrompt('COHERENCE', `\n[COHERENCE RULE]
All outfit components must work together as a visually cohesive outfit.
Colors, materials, and style should harmonize across all slots.
The final result must look like a single, intentionally designed outfit — not a random combination.`));

    return parts.join('\n\n');
}

/**
 * Wrap a base prompt with multi-view perspective instructions
 * @param {string} basePrompt - The core outfit/edit prompt
 * @param {string} perspective - 'front' | 'back' | 'side'
 * @returns {string} Prompt with perspective instructions appended
 */
function buildMultiViewPrompt(basePrompt, perspective = 'front') {
    const viewPrompt = MULTI_VIEW_PROMPTS[perspective];
    if (!viewPrompt) return basePrompt;

    return `${basePrompt}\n\n${viewPrompt}`;
}

// =============================================================================
// ELEMENT EXTRACTION (Phase 3) — Extract individual outfit elements
// =============================================================================

const ELEMENT_EXTRACTION_PROMPT = `[ELEMENT EXTRACTION — SOLID PURE WHITE BACKGROUND]
You are a professional asset extraction tool for game character design.
Your task is to ISOLATE a single outfit element from the reference character image and render it as a standalone item.

CRITICAL RULES:
- Extract ONLY the specified element, nothing else
- The element must be rendered on a PURE SOLID WHITE BACKGROUND (#FFFFFF). 
- DO NOT draw a checkerboard transparency grid! Use a continuous, solid, crisp white background so that our AI bg-removal tool can easily cut it out later.
- Maintain the EXACT same design, colors, patterns, materials, and details
- The element should be centered in the frame and fill most of the canvas
- Render at highest quality with clean edges (no jagged outlines)
- The element should look like a flat-laid product shot or game inventory icon
- DO NOT include any body parts, other clothing, or context
- DO NOT add shadows, reflections, or environment lighting
- Clean, crisp edges suitable for compositing`;

/**
 * Build prompt for extracting a single element from a character image
 * @param {string} slotKey - The slot key (e.g., 'top_inner', 'jacket')
 * @param {string} description - Optional user description of the element
 * @param {string} perspective - Camera perspective instruction, e.g., 'a_side_right'
 * @returns {string} Full extraction prompt
 */
function buildElementExtractionPrompt(slotKey, description = '', perspective = 'default') {
    const slotDef = OUTFIT_SLOTS[slotKey];
    if (!slotDef) return ELEMENT_EXTRACTION_PROMPT;

    const slotPrompt = SLOT_EXTRACTION_PROMPTS[slotKey] || '';
    
    let prompt = ELEMENT_EXTRACTION_PROMPT;
    prompt += `\n\n[TARGET ELEMENT: ${slotDef.name.toUpperCase()} (${slotDef.nameVi})]`;
    prompt += `\nBody region to extract from: ${slotDef.bodyRegion}`;
    
    if (perspective !== 'default' && MULTI_VIEW_PROMPTS[perspective]) {
        prompt += `\n\n[EXTRACTION ANGLE REQUIREMENT]\nRender this extracted item from the perspective described below:\n${MULTI_VIEW_PROMPTS[perspective]}`;
    }

    prompt += `\n${slotPrompt}`;
    
    if (description) {
        prompt += `\n\n[USER DESCRIPTION]\n${description}`;
    }

    prompt += `\n\n[OUTPUT REQUIREMENT]
- Render the extracted ${slotDef.name} as a standalone item
- PURE SOLID WHITE BACKGROUND (NO checkerboard, NO grey)
- The item should be shown as if laid flat or displayed as a game inventory item
- STRICT TEXTURE PRESERVATION: Copy the EXACT game texture, material, and lighting from the reference image. DO NOT make it hyper-realistic.
- ${FF_STYLE_CONSISTENCY_PROMPT}
- Size: Fill the 1024x1024 canvas, centered`;

    return prompt;
}

// =============================================================================
// INCREMENTAL SLOT PROMPT BUILDER — for adding one slot at a time
// =============================================================================

/**
 * Build a prompt for adding a SINGLE slot to an already-rendered character image
 * Used in incremental mode where the base image already has previous outfits applied
 * @param {string} slot - The slot key being added (e.g., 'scarf', 'stockings')
 * @param {string} description - User description of the item
 * @param {number} referenceImageCount - Number of reference images for this slot
 * @param {Object} options - { preserveFace, ffMode, promptOverrides }
 * @returns {string} Complete prompt for a single-slot incremental edit
 */
function buildIncrementalSlotPrompt(slot, description, referenceImageCount = 0, options = {}) {
    const {
        preserveFace = true,
        ffMode = false,
        promptOverrides = {},
    } = options;

    const parts = [];
    const getPrompt = (key, fallback) => promptOverrides[key] || fallback;

    // Face lock
    if (preserveFace) {
        parts.push(getPrompt('FACE_CONSISTENCY', FACE_CONSISTENCY_PROMPT));
    }

    // Incremental mode header
    parts.push(INCREMENTAL_MODE_PROMPT);

    // FF style enforcement
    if (ffMode) {
        parts.push(FF_CHARACTER_CONTEXT);
    }
    // Always enforce FF 3D style for accessories
    parts.push(getPrompt('FF_STYLE', FF_STYLE_CONSISTENCY_PROMPT));

    // Pose lock
    parts.push(POSE_LOCK_PROMPT);

    // Single image constraint
    parts.push(SINGLE_IMAGE_CONSTRAINT);
    parts.push(PIXEL_QUALITY_PROMPT);

    // Aspect ratio lock (v3.0)
    parts.push(ASPECT_RATIO_LOCK_PROMPT);

    // Pixel recovery if requested (v3.0)
    if (options.pixelRecovery) {
        parts.push(PIXEL_RECOVERY_PROMPT);
    }

    // Framing lock
    parts.push(getPrompt('FRAMING_LOCK', `[CRITICAL — USE PROVIDED IMAGE CONTEXT AND FRAMING]
You MUST use the provided [BASE CHARACTER IMAGE] as your exact canvas.
- DO NOT generate a new character from scratch.
- The output MUST maintain the EXACT same crop, frame, zoom level, camera distance, and dimension as the base image.
- If the base image is a full body, the output MUST be perfectly full body. DO NOT ZOOM IN on the clothing or character torso.`));

    // The single slot instruction
    const slotDef = OUTFIT_SLOTS[slot];
    if (slotDef) {
        parts.push(`\n--- TARGET SLOT: ${slotDef.name.toUpperCase()} (${slotDef.nameVi}) ---`);
        parts.push(`Target body region: ${slotDef.bodyRegion}`);
        
        // Slot-specific extraction prompt with zone lock
        const slotOverride = (promptOverrides.SLOT_OVERRIDES && promptOverrides.SLOT_OVERRIDES[slot]) || null;
        parts.push(slotOverride || SLOT_EXTRACTION_PROMPTS[slot] || '');

        if (referenceImageCount > 0) {
            parts.push(`${referenceImageCount} reference image(s) provided for this slot. Extract the design and apply ONLY to the specified body region.`);
        }

        if (description) {
            parts.push(`\nDesired ${slotDef.name}: ${description}`);
        }
    }

    // Color preservation
    parts.push(getPrompt('COLOR_PRESERVE', `[CRITICAL — COLOR & PATTERN FIDELITY]
When a reference image is provided:
- Match the EXACT colors from the reference: hue, saturation, brightness
- RED must stay RED, WHITE must stay WHITE
- Preserve ALL patterns: stripes, logos, prints, embroidery
- Material appearance must match the reference exactly`));

    return parts.join('\n\n');
}

// =============================================================================
// HEAD EDITOR SYSTEM
// =============================================================================

const HEAD_EDIT_SLOTS = {
    face_tattoo:  { name: 'Face Tattoo',  nameVi: 'Hình xăm mặt',   icon: '🔥', description: 'Add or modify tattoos on the face and neck' },
    face_makeup:  { name: 'Makeup',       nameVi: 'Trang điểm',      icon: '💄', description: 'Makeup, eyeshadow, lipstick, blush' },
    face_scar:    { name: 'Scar/Mark',    nameVi: 'Sẹo/Dấu vết',    icon: '⚡', description: 'Battle scars, birthmarks, face paint' },
    face_shape:   { name: 'Face Shape',   nameVi: 'Khuôn mặt',      icon: '🎭', description: 'Modify facial structure (subtle)' },
    eyes:         { name: 'Eyes',         nameVi: 'Mắt',             icon: '👁️', description: 'Eye color, glow, contact lenses' },
    hair_color:   { name: 'Hair Color',   nameVi: 'Màu tóc',         icon: '🎨', description: 'Change hair color or highlights' },
};

/**
 * Build a prompt for head/face-only editing (Head Editor tab)
 * @param {string} editDescription - What to change on the face
 * @param {Object} options - { editType, preserveIdentity, hasReference }
 * @returns {string} Complete prompt for Gemini
 */
function buildHeadEditPrompt(editDescription, options = {}) {
    const {
        editType = 'face_tattoo',
        preserveIdentity = true,
        hasReference = false,
    } = options;

    const parts = [];

    // Identity preservation (critical for face edits)
    if (preserveIdentity) {
        parts.push(`[CRITICAL — HEAD EDIT MODE — FACE IDENTITY PRESERVATION]
This is a HEAD-ONLY edit. You are modifying a cropped head/face region.
You MUST preserve the character's fundamental facial structure:
- Face shape, skull proportions, jawline — UNCHANGED
- Eye positions and spacing — UNCHANGED (only color/effect may change if explicitly requested)
- Nose bridge and tip — UNCHANGED
- Mouth position and lip shape — UNCHANGED unless explicitly changing lips
- Skin tone — UNCHANGED
- Hair style and shape — UNCHANGED unless explicitly changing hair
- Existing tattoos/markings — PRESERVE unless replacing them
Only modify exactly what is described in the edit instruction.`);
    }

    // Zone constraint
    parts.push(`[ZONE CONSTRAINT — HEAD REGION ONLY]
This image contains ONLY the character's head and face (cropped).
Apply ALL changes ONLY to the face/head area.
Do NOT alter the background, lighting direction, or framing.`);

    // FF Style
    parts.push(FF_STYLE_CONSISTENCY_PROMPT);

    // Single image output
    parts.push(SINGLE_IMAGE_CONSTRAINT);
    parts.push(PIXEL_QUALITY_PROMPT);

    // Reference image instruction
    if (hasReference) {
        parts.push(`[REFERENCE IMAGE]
A reference image has been provided. Extract the design/pattern/detail from the reference
and apply it to the face/head region as described. Match colors and details as closely as possible.`);
    }

    // The actual edit instruction
    const editTypeLabels = {
        face_tattoo: '[FACE TATTOO EDIT]\nAdd or modify the tattoo on the face/neck region.',
        face_makeup: '[MAKEUP EDIT]\nApply makeup to the face.',
        face_scar:   '[SCAR/MARK EDIT]\nAdd battle scars, face paint, or distinctive markings.',
        face_shape:  '[FACE SHAPE EDIT]\nSubtly modify facial structure while preserving identity.',
        eyes:        '[EYE EDIT]\nModify eye appearance: color, glow, contact lens effect.',
        hair_color:  '[HAIR COLOR EDIT]\nChange hair color or add highlights/ombre effects.',
    };
    parts.push(editTypeLabels[editType] || '[FACE EDIT]');
    parts.push(`Edit instruction: ${editDescription}`);

    return parts.join('\n\n');
}

/**
 * Build a prompt for compositing an edited head back onto a body
 * @returns {string} Compositing prompt
 */
const HEAD_COMPOSITE_PROMPT = `[HEAD COMPOSITING TASK]
You are given two images:
[IMAGE 1] = FULL BODY CHARACTER with original/old head
[IMAGE 2] = EDITED HEAD (cropped, already modified)

Your task: Replace the head in IMAGE 1 with the head from IMAGE 2.

Rules:
- Match the neck connection point seamlessly — no visible seam or color shift at the junction
- Preserve the body pose, outfit, background, and ALL body region pixels from IMAGE 1 exactly
- The edited head from IMAGE 2 must be scaled and positioned to match the original head's
  position, size, and angle in IMAGE 1
- Blend the head smoothly into the neck area with proper lighting continuity
- Output EXACTLY ONE full body image with the replaced head
- Do NOT change any part of the body, outfit, or background

The result must look like the character always had this head — seamless, natural, single image.`;

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

    // Anti-degradation v3.0
    SINGLE_IMAGE_CONSTRAINT,
    POSE_LOCK_PROMPT,
    PIXEL_QUALITY_PROMPT,
    ASPECT_RATIO_LOCK_PROMPT,
    PIXEL_RECOVERY_PROMPT,

    // Modular Outfit System v4.0
    OUTFIT_SLOTS,
    SLOT_EXTRACTION_PROMPTS,
    FF_STYLE_CONSISTENCY_PROMPT,
    INCREMENTAL_MODE_PROMPT,
    BODY_ANATOMY_PROMPT,
    BODY_TYPE_PROMPTS,
    ONE_PIECE_PROMPT,
    MULTI_VIEW_PROMPTS,
    buildComponentPrompt,
    buildModularOutfitPrompt,
    buildIncrementalSlotPrompt,
    buildMultiViewPrompt,

    // Phase 3: Element Extraction
    ELEMENT_EXTRACTION_PROMPT,
    buildElementExtractionPrompt,

    // Head Editor System
    HEAD_EDIT_SLOTS,
    HEAD_COMPOSITE_PROMPT,
    buildHeadEditPrompt,
};
