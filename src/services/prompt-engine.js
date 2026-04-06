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

const POSE_LOCK_PROMPT = `[POSE PRESERVATION — DO NOT CHANGE]
Do NOT change the character's body pose, stance, body position, limb positions,
camera angle, or framing in ANY way. The character must remain in the EXACT same
pose as the input image. Only modify what is explicitly requested (style/outfit/etc).
If the task is style transfer, the pose must be pixel-perfectly preserved.`;

const PIXEL_QUALITY_PROMPT = `[QUALITY — PIXEL FIDELITY]
The output image MUST maintain the same resolution and pixel quality as the input.
Do NOT downscale, add compression artifacts, blur, or soften the image.
Preserve sharp edges, clean anti-aliasing, and high-frequency details.
If the input is a high-res game render, the output must be equally crisp and detailed.
Do NOT introduce noise, grain, or any degradation not present in the original.`;

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
// MODULAR OUTFIT SYSTEM — Slot Definitions
// =============================================================================

const OUTFIT_SLOTS = {
    head: {
        name: 'Head',
        nameVi: 'Đầu',
        icon: '🎩',
        subCategories: ['Hair', 'Hats', 'Helmets', 'Head accessories', 'Headbands', 'Crowns'],
        bodyRegion: 'above the neckline, covering the skull and hair area',
    },
    face: {
        name: 'Face',
        nameVi: 'Mặt',
        icon: '🕶️',
        subCategories: ['Glasses', 'Sunglasses', 'Makeup', 'Masks', 'Face paint', 'Visors', 'Scarves (face-covering)'],
        bodyRegion: 'the facial area from forehead to chin, ear to ear',
    },
    top: {
        name: 'Top',
        nameVi: 'Áo',
        icon: '👕',
        subCategories: ['Shirts', 'Jackets', 'Vests', 'Hoodies', 'Armor (upper)', 'Tank tops', 'Coats'],
        bodyRegion: 'torso from shoulders to waist, including arms/sleeves',
    },
    bottom: {
        name: 'Bottom',
        nameVi: 'Quần',
        icon: '👖',
        subCategories: ['Pants', 'Shorts', 'Skirts', 'Tactical trousers', 'Armor (lower)', 'Joggers'],
        bodyRegion: 'from waist to ankles, covering legs and hip area',
    },
    footwear: {
        name: 'Footwear',
        nameVi: 'Giày',
        icon: '👟',
        subCategories: ['Shoes', 'Boots', 'Sneakers', 'Combat boots', 'Sandals', 'High heels', 'Armored boots'],
        bodyRegion: 'feet and ankle area, from ankle down',
    },
};

// Per-slot feature extraction templates
const SLOT_EXTRACTION_PROMPTS = {
    head: `[SLOT: HEAD — Feature Extraction]
Analyze the reference image for the HEAD slot. Extract:
- Hair style, length, color, texture (straight/curly/wavy)
- Any headwear: hat/helmet type, shape, color, material, logos/emblems
- Head accessories: headbands, ear pieces, hair clips, goggles on head
Reproduce these exact head elements on the target character.`,

    face: `[SLOT: FACE — Feature Extraction]
Analyze the reference image for the FACE slot. Extract:
- Glasses/sunglasses: frame shape, lens color, style
- Makeup details: eye shadow, lipstick, blush colors and intensity
- Masks: type, coverage area, material, straps
- Face paint patterns, tattoos, or markings
Apply these exact face accessories/cosmetics to the target character.
CRITICAL: Do NOT alter the character's underlying facial identity.`,

    top: `[SLOT: TOP — Feature Extraction]
Analyze the reference image for the TOP/UPPER BODY slot. Extract:
- Garment type: shirt, jacket, vest, hoodie, armor, etc.
- Colors, patterns, prints, logos, text on the garment
- Material: fabric, leather, metal, nylon, etc.
- Details: zippers, buttons, pockets, straps, shoulder pads, collar style
- Sleeve length and style
- Layering: inner shirt + outer jacket, etc.
Reproduce this exact upper body outfit on the target character.`,

    bottom: `[SLOT: BOTTOM — Feature Extraction]
Analyze the reference image for the BOTTOM/LOWER BODY slot. Extract:
- Garment type: pants, shorts, skirt, tactical trousers, etc.
- Colors, patterns, camouflage, stripes
- Material: denim, cotton, leather, armor plating
- Details: belt, pockets, knee pads, cargo pouches, rips/tears
- Fit: skinny, slim, baggy, tactical
Reproduce this exact lower body outfit on the target character.`,

    footwear: `[SLOT: FOOTWEAR — Feature Extraction]
Analyze the reference image for the FOOTWEAR slot. Extract:
- Shoe/boot type: sneakers, combat boots, high heels, sandals
- Colors, brand markings, logos
- Material: leather, canvas, rubber, metal
- Details: laces, buckles, straps, soles, ankle height
- Style: military, sporty, casual, formal
Reproduce this exact footwear on the target character.`,
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
The final output must look like an official FreeFire character render, NOT a photo edit.`;

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

const MULTI_VIEW_PROMPTS = {
    front: `[CAMERA PERSPECTIVE — FRONT VIEW]
Render the character from a direct FRONT view:
- Camera positioned directly in front of the character, at chest/eye height
- The character faces the camera head-on
- Symmetrical framing showing both sides equally
- Full body visible from head to feet
- Standard studio lighting: key light from front-left, fill from front-right, rim light from behind`,

    back: `[CAMERA PERSPECTIVE — BACK VIEW]
Render the character from a direct BACK view:
- Camera positioned directly behind the character, at chest height
- The character's back faces the camera
- Show the back details of all outfit components: jacket back, rear pockets, shoe heels
- Full body visible from head to feet
- The character should look EXACTLY the same person, just viewed from behind
- Hair should be visible from behind (ponytail, back of hat, etc.)
- Maintain the same lighting setup as the front view, rotated 180 degrees`,

    side: `[CAMERA PERSPECTIVE — SIDE VIEW (3/4 Profile)]
Render the character from a 3/4 SIDE view (approximately 45-degree angle):
- Camera positioned at roughly 45 degrees to the character's right side
- Shows depth and dimensionality of the outfit
- Profile of face partially visible
- Full body visible from head to feet
- This angle should reveal layering: how jacket sits over shirt, belt over pants, etc.
- Maintain the same lighting setup, adjusted for the new camera angle`,
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
function buildComponentPrompt(slot, description, referenceImageCount = 0, options = {}) {
    const slotDef = OUTFIT_SLOTS[slot];
    if (!slotDef) return '';

    const parts = [];

    parts.push(`[COMPONENT: ${slotDef.name.toUpperCase()} — ${slotDef.nameVi}]`);
    parts.push(`Body region: ${slotDef.bodyRegion}`);
    parts.push(`Possible items: ${slotDef.subCategories.join(', ')}`);

    if (referenceImageCount > 0) {
        parts.push(SLOT_EXTRACTION_PROMPTS[slot]);
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
        ffMode = false,  // v2.3: FF mode optional
    } = options;

    const parts = [];

    // Face consistency (highest priority — always first)
    if (preserveFace) {
        parts.push(FACE_CONSISTENCY_PROMPT);
        if (faceRefCount > 1) {
            parts.push(FACE_MULTI_ANGLE_PROMPT);
        }
    }

    // v2.3: FF context only when enabled
    if (ffMode) {
        parts.push(FF_CHARACTER_CONTEXT);
        parts.push(FF_STYLE_CONSISTENCY_PROMPT);
    }

    // v2.3: Core instruction
    // v2.3: Core instruction & STRICT Framing Lock
    parts.push(`[CRITICAL — USE PROVIDED IMAGE CONTEXT AND FRAMING]
You MUST use the provided [BASE CHARACTER IMAGE] as your exact canvas.
- DO NOT generate a new character from scratch.
- The output MUST maintain the EXACT same crop, frame, zoom level, camera distance, and dimension as the base image.
- If the base image is a full body, the output MUST be perfectly full body. DO NOT ZOOM IN on the clothing or character torso.`);

    // Body anatomy constraints
    parts.push(BODY_ANATOMY_PROMPT);
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

    // Main outfit instruction header
    parts.push(`[MODULAR OUTFIT CHANGE]
Change the character's outfit using the following component specifications.
Each component targets a specific body region. Apply ALL active components simultaneously.
Keep the character's face, identity, body pose, proportions, background, and most importantly the CAMERA ZOOM/FRAMING COMPLETELY UNCHANGED.`);

    // Add each active slot
    const slotOrder = ['head', 'face', 'top', 'bottom', 'footwear'];
    let activeSlots = 0;

    for (const slot of slotOrder) {
        // Skip bottom if one-piece mode
        if (isOnePiece && slot === 'bottom') continue;

        const comp = components[slot];
        if (!comp || (!comp.description && !comp.refCount)) continue;

        // For one-piece, relabel top
        const label = (isOnePiece && slot === 'top') ? 'top (ONE-PIECE / Full Body)' : slot;

        const slotPrompt = buildComponentPrompt(
            slot,
            comp.description || '',
            comp.refCount || 0,
            options
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
    parts.push(`\n[COHERENCE RULE]
All outfit components must work together as a visually cohesive outfit.
Colors, materials, and style should harmonize across all slots.
The final result must look like a single, intentionally designed outfit — not a random combination.`);

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

    // Anti-degradation v2.2
    SINGLE_IMAGE_CONSTRAINT,
    POSE_LOCK_PROMPT,
    PIXEL_QUALITY_PROMPT,

    // Modular Outfit System v2.1
    OUTFIT_SLOTS,
    SLOT_EXTRACTION_PROMPTS,
    FF_STYLE_CONSISTENCY_PROMPT,
    BODY_ANATOMY_PROMPT,
    BODY_TYPE_PROMPTS,
    ONE_PIECE_PROMPT,
    MULTI_VIEW_PROMPTS,
    buildComponentPrompt,
    buildModularOutfitPrompt,
    buildMultiViewPrompt,
};
