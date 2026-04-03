// =============================================================================
// 3K FreeFire Studio — FreeFire Presets
// =============================================================================
// Placeholder outfit, pose, and style presets for FreeFire characters
// Outfits sẽ được bổ sung chi tiết sau
// =============================================================================

(function (global) {
    'use strict';

    // ─── Outfit Presets (Placeholder — sẽ bổ sung sau) ──────────────────

    const FF_OUTFIT_PRESETS = {
        casual_sport: {
            name: 'Thể Thao Casual',
            nameEn: 'Casual Sport',
            icon: '🏃',
            description: 'Casual sporty outfit with hoodie jacket, jogger pants, and sneakers. Bright colors with stripe details. Athletic and modern look.',
        },
        military: {
            name: 'Quân Đội',
            nameEn: 'Military',
            icon: '🎖️',
            description: 'Military tactical combat outfit with camouflage pattern, tactical vest with pouches, combat boots, and military beret or helmet. Dark green and brown tones.',
        },
        futuristic: {
            name: 'Tương Lai',
            nameEn: 'Futuristic',
            icon: '🤖',
            description: 'Futuristic sci-fi battle suit with glowing neon accents, metallic armor plates, high-tech visor or HUD glasses. Sleek black with electric blue glow effects.',
        },
        traditional: {
            name: 'Truyền Thống',
            nameEn: 'Traditional',
            icon: '🏮',
            description: 'Traditional Asian-inspired outfit with ornate patterns, silk fabric, gold embroidery details. Elegant and regal appearance with cultural motifs.',
        },
        bikini_beach: {
            name: 'Bikini / Bãi Biển',
            nameEn: 'Beach Wear',
            icon: '🏖️',
            description: 'Summer beach outfit with stylish swimwear, sunglasses, and beach accessories. Bright tropical colors and patterns.',
        },
        formal_suit: {
            name: 'Vest Lịch Lãm',
            nameEn: 'Formal Suit',
            icon: '🤵',
            description: 'Elegant formal suit with tailored blazer, dress shirt, tie or bow tie, fitted trousers, and polished dress shoes. Premium luxury look.',
        },
    };

    // ─── Pose Presets ───────────────────────────────────────────────────

    const FF_POSE_PRESETS = {
        standing_idle: {
            name: 'Đứng Thường',
            nameEn: 'Standing Idle',
            icon: '🧍',
            description: 'Standing idle pose, relaxed stance, weight on one leg, arms naturally at sides, facing the camera',
        },
        victory: {
            name: 'Ăn Mừng',
            nameEn: 'Victory',
            icon: '✌️',
            description: 'Victory celebration pose, one fist raised in the air, confident expression, slight lean back, triumphant stance',
        },
        action_shooting: {
            name: 'Bắn Súng',
            nameEn: 'Action Shooting',
            icon: '🔫',
            description: 'Dynamic shooting action pose, holding weapon with both hands aimed forward, slight tactical crouch, intense expression',
        },
        running: {
            name: 'Chạy',
            nameEn: 'Running',
            icon: '🏃',
            description: 'Running pose mid-stride, arms pumping, dynamic forward motion, one foot off the ground',
        },
        sitting: {
            name: 'Ngồi',
            nameEn: 'Sitting',
            icon: '🪑',
            description: 'Sitting pose, legs crossed casually, one hand resting on knee, relaxed posture',
        },
        t_pose: {
            name: 'T-Pose',
            nameEn: 'T-Pose',
            icon: '✝️',
            description: 'T-pose with arms extended horizontally, standing straight, facing camera directly, neutral expression',
        },
        crouching: {
            name: 'Ngồi Xổm',
            nameEn: 'Crouching',
            icon: '🔽',
            description: 'Tactical crouch position, one knee down, ready combat stance, alert expression',
        },
        jumping: {
            name: 'Nhảy',
            nameEn: 'Jumping',
            icon: '⬆️',
            description: 'Mid-air jump pose, legs tucked, arms spread for balance, dynamic airborne position',
        },
        dancing: {
            name: 'Nhảy Múa',
            nameEn: 'Dancing',
            icon: '💃',
            description: 'Dynamic dance pose, one leg lifted, arms in expressive dance position, joyful expression',
        },
        kneeling: {
            name: 'Quỳ',
            nameEn: 'Kneeling',
            icon: '🦵',
            description: 'Kneeling on one knee, looking forward with determination, hands at sides',
        },
    };

    // ─── Style Presets ──────────────────────────────────────────────────

    const FF_STYLE_PRESETS = {
        '3d_render': {
            name: 'Render 3D Game',
            nameEn: '3D Game Render',
            icon: '🎮',
            description: 'High-quality 3D game character render',
        },
        'realistic': {
            name: 'Ảnh Thực Tế',
            nameEn: 'Photorealistic',
            icon: '📷',
            description: 'Photorealistic human photograph',
        },
        'semi_realistic': {
            name: 'Bán Thực Tế',
            nameEn: 'Semi-Realistic',
            icon: '🎬',
            description: 'Semi-realistic CGI/cinema quality',
        },
        'anime': {
            name: 'Anime',
            nameEn: 'Anime Style',
            icon: '🎌',
            description: 'Anime/manga illustration style',
        },
    };

    // ─── Preset Workflows ───────────────────────────────────────────────

    const FF_PRESET_WORKFLOWS = {
        outfit_change: {
            name: 'Đổi Trang Phục',
            nameEn: 'Outfit Change',
            icon: '👗',
            description: 'Thay đổi trang phục, giữ nguyên mặt & pose',
            nodes: [
                { type: 'ff/image_input', pos: [100, 200] },
                { type: 'ff/face_reference', pos: [380, 150] },
                { type: 'ff/outfit_selector', pos: [380, 350] },
                { type: 'ff/output', pos: [700, 250] },
            ],
            connections: [
                [0, 0, 1, 0],
                [1, 1, 2, 0],
                [1, 0, 2, 1],
                [2, 0, 3, 0],
            ],
        },
        modular_outfit: {
            name: 'Outfit Modular',
            nameEn: 'Modular Outfit',
            icon: '🧩',
            description: 'Tùy chỉnh từng bộ phận: Đầu, Mặt, Áo, Quần, Giày',
            nodes: [
                { type: 'ff/image_input', pos: [80, 200] },
                { type: 'ff/face_reference', pos: [340, 100] },
                { type: 'ff/body_anatomy_mapper', pos: [340, 300] },
                { type: 'ff/component_selector', pos: [640, 200] },
                { type: 'ff/output', pos: [980, 250] },
            ],
            connections: [
                [0, 0, 1, 0],
                [0, 0, 2, 0],
                [1, 1, 3, 0],
                [1, 0, 3, 1],
                [2, 0, 3, 2],
                [3, 0, 4, 0],
            ],
        },
        pose_change: {
            name: 'Đổi Pose',
            nameEn: 'Pose Change',
            icon: '💃',
            description: 'Thay đổi tư thế nhân vật',
            nodes: [
                { type: 'ff/image_input', pos: [100, 200] },
                { type: 'ff/face_reference', pos: [380, 150] },
                { type: 'ff/pose_selector', pos: [380, 350] },
                { type: 'ff/output', pos: [700, 250] },
            ],
            connections: [
                [0, 0, 1, 0],
                [1, 1, 2, 0],
                [1, 0, 2, 1],
                [2, 0, 3, 0],
            ],
        },
        style_transfer: {
            name: 'Chuyển Style',
            nameEn: 'Style Transfer',
            icon: '🎨',
            description: 'Chuyển đổi phong cách hình ảnh',
            nodes: [
                { type: 'ff/image_input', pos: [100, 200] },
                { type: 'ff/face_reference', pos: [380, 150] },
                { type: 'ff/style_selector', pos: [380, 350] },
                { type: 'ff/output', pos: [700, 250] },
            ],
            connections: [
                [0, 0, 1, 0],
                [1, 1, 2, 0],
                [1, 0, 2, 1],
                [2, 0, 3, 0],
            ],
        },
        full_restyle: {
            name: 'Tùy Chỉnh Toàn Bộ',
            nameEn: 'Full Restyle',
            icon: '🔥',
            description: 'Đổi outfit + pose + style cùng lúc',
            nodes: [
                { type: 'ff/image_input', pos: [80, 200] },
                { type: 'ff/face_reference', pos: [340, 100] },
                { type: 'ff/outfit_selector', pos: [340, 280] },
                { type: 'ff/pose_selector', pos: [620, 180] },
                { type: 'ff/style_selector', pos: [620, 380] },
                { type: 'ff/output', pos: [900, 280] },
            ],
            connections: [
                [0, 0, 1, 0],
                [1, 1, 2, 0],
                [1, 0, 2, 1],
                [2, 0, 3, 0],
                [1, 0, 3, 1],
                [3, 0, 4, 0],
                [1, 0, 4, 1],
                [4, 0, 5, 0],
            ],
        },
    };

    // ─── Component Presets (Per-slot breakdowns) ─────────────────────────

    const FF_COMPONENT_PRESETS = {
        casual_sport: {
            head: { description: 'Sports cap or headband, sporty hairstyle' },
            face: { description: 'Sports sunglasses, no makeup' },
            top: { description: 'Hoodie jacket with stripe details, bright athletic colors, zip-up front' },
            bottom: { description: 'Jogger pants with side stripes, elastic waistband, tapered fit' },
            footwear: { description: 'Modern running sneakers, bright accent colors, lightweight design' },
        },
        military: {
            head: { description: 'Military beret or tactical helmet with NVG mount, camo pattern' },
            face: { description: 'Tactical face mask or bandana, dark face paint' },
            top: { description: 'Camouflage tactical vest with magazine pouches, combat shirt underneath, dark green/brown tones' },
            bottom: { description: 'Cargo combat pants with knee pads, multiple pockets, camouflage pattern' },
            footwear: { description: 'Black combat boots, high-ankle, reinforced toe, military spec' },
        },
        futuristic: {
            head: { description: 'High-tech visor or HUD display headset, neon-lit ear pieces' },
            face: { description: 'Holographic HUD glasses with glowing blue lens, cyberpunk style' },
            top: { description: 'Sleek black metallic armor plates with electric blue glow, futuristic battle suit, neon accent lines' },
            bottom: { description: 'Form-fitting tech pants with embedded LED strips, carbon fiber knee guards' },
            footwear: { description: 'Anti-gravity boots with glowing soles, metallic finish, magnetic clasps' },
        },
        traditional: {
            head: { description: 'Ornate traditional headpiece or crown with gold details' },
            face: { description: 'Traditional ceremonial makeup, gold face accents' },
            top: { description: 'Silk robe/ao dai with ornate gold embroidery, elaborate patterns, cultural motifs' },
            bottom: { description: 'Flowing silk pants or layered skirt with traditional patterns' },
            footwear: { description: 'Traditional embroidered shoes or sandals with gold trim' },
        },
        formal_suit: {
            head: { description: 'Slicked back professional hairstyle' },
            face: { description: 'No accessories or elegant reading glasses' },
            top: { description: 'Tailored blazer with dress shirt and tie, premium luxury cut, dark fabric' },
            bottom: { description: 'Fitted dress trousers with sharp crease, matching blazer fabric' },
            footwear: { description: 'Polished Oxford dress shoes, black leather, detailed stitching' },
        },
    };

    // ─── Export to global ───────────────────────────────────────────────

    global.FF_OUTFIT_PRESETS = FF_OUTFIT_PRESETS;
    global.FF_POSE_PRESETS = FF_POSE_PRESETS;
    global.FF_STYLE_PRESETS = FF_STYLE_PRESETS;
    global.FF_PRESET_WORKFLOWS = FF_PRESET_WORKFLOWS;
    global.FF_COMPONENT_PRESETS = FF_COMPONENT_PRESETS;

    console.log('[FF Presets] ✓ Loaded', Object.keys(FF_OUTFIT_PRESETS).length, 'outfits,',
        Object.keys(FF_POSE_PRESETS).length, 'poses,',
        Object.keys(FF_STYLE_PRESETS).length, 'styles,',
        Object.keys(FF_COMPONENT_PRESETS).length, 'component presets');

})(window);
