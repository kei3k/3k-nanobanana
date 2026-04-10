// =============================================================================
// 3K FreeFire Studio — Flow Editor v1.0 (Weavy-Style)
// =============================================================================
// Custom canvas-based node editor with inline image previews
// + Visual Pipeline Prompt Studio
// =============================================================================

const FlowEditor = {
    // ─── State ────────────────────────────────────────────────────────────
    nodes: [],
    connections: [],
    nextId: 1,
    canvas: null,
    canvasEl: null,

    // Viewport
    panX: 0,
    panY: 0,
    zoom: 1,

    // Interaction
    dragging: null,
    connecting: null,
    selectedNodeId: null,
    isPanning: false,
    panStart: null,
    contextMenu: null,
    _tempConnEnd: null,
    _initialized: false,

    // ─── Node Type Definitions ────────────────────────────────────────────
    nodeTypes: {
        'flow/prompt': {
            title: 'Prompt',
            icon: '✏️',
            category: 'input',
            width: 260,
            inputs: [],
            outputs: [{ id: 'text', label: 'Text', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Character Description', placeholder: 'Mô tả nhân vật FreeFire...' },
            ],
        },
        'flow/image_input': {
            title: 'Image Input',
            icon: '🖼️',
            category: 'input',
            width: 240,
            inputs: [],
            outputs: [{ id: 'image', label: 'Image', type: 'image' }],
            fields: [
                { id: 'upload', type: 'button', label: 'Upload Image', buttonText: '📁 Chọn Ảnh hoặc Kéo Thả' },
            ],
            hasPreview: true,
        },
        'flow/face_ref': {
            title: 'Face Reference',
            icon: '🎭',
            category: 'input',
            width: 240,
            inputs: [],
            outputs: [{ id: 'face', label: 'Face', type: 'image' }],
            fields: [
                { id: 'upload', type: 'button', label: 'Face Image', buttonText: '🎭 Tải Ảnh Mặt' },
            ],
            hasPreview: true,
        },
        'flow/image_gen': {
            title: 'AI Image Generator',
            icon: '🎨',
            category: 'process',
            width: 280,
            inputs: [
                { id: 'prompt', label: 'Prompt', type: 'text' },
                { id: 'ref_image', label: 'Reference', type: 'image' },
            ],
            outputs: [{ id: 'image', label: 'Image', type: 'image' }],
            fields: [
                { id: 'model', type: 'select', label: 'Model', options: [
                    { value: 'pro', label: '🔥 Nano Banana Pro' },
                    { value: 'flash', label: '⚡ Nano Banana 2 (Flash)' },
                ]},
            ],
            hasPreview: true,
        },
        'flow/angle_control': {
            title: 'Angle Control',
            icon: '🔄',
            category: 'process',
            width: 260,
            inputs: [{ id: 'image', label: 'Source', type: 'image' }],
            outputs: [{ id: 'image', label: 'Rotated', type: 'image' }],
            fields: [
                { id: 'angle', type: 'select', label: 'Camera Angle', options: [
                    { value: 'a_front', label: '👤 A-Pose Front' },
                    { value: 'a_back', label: '🔙 A-Pose Back' },
                    { value: 'a_side_right', label: '➡️ A-Pose Right' },
                    { value: 'a_side_left', label: '⬅️ A-Pose Left' },
                ]},
            ],
            hasPreview: true,
        },
        'flow/remove_bg': {
            title: 'Remove Background',
            icon: '✂️',
            category: 'process',
            width: 240,
            inputs: [{ id: 'image', label: 'Image', type: 'image' }],
            outputs: [{ id: 'image', label: 'No BG', type: 'image' }],
            fields: [],
            hasPreview: true,
        },
        'flow/composite': {
            title: 'Composite Strip',
            icon: '🎞️',
            category: 'output',
            width: 300,
            inputs: [
                { id: 'img1', label: 'Image 1', type: 'image' },
                { id: 'img2', label: 'Image 2', type: 'image' },
                { id: 'img3', label: 'Image 3', type: 'image' },
                { id: 'img4', label: 'Image 4', type: 'image' },
                { id: 'img5', label: 'Image 5', type: 'image' },
            ],
            outputs: [{ id: 'strip', label: 'Strip', type: 'image' }],
            fields: [
                { id: 'layout', type: 'select', label: 'Layout', options: [
                    { value: 'horizontal', label: '↔️ Horizontal Strip' },
                    { value: 'vertical', label: '↕️ Vertical Stack' },
                ]},
            ],
            hasPreview: true,
        },
        'flow/output': {
            title: 'Output',
            icon: '📤',
            category: 'output',
            width: 240,
            inputs: [{ id: 'image', label: 'Final Image', type: 'image' }],
            outputs: [],
            fields: [],
            hasPreview: true,
        },

        // ═══════════════════════════════════════════════════════════════════
        // VISUAL PIPELINE — Các node prompt (chỉnh sửa được)
        // ═══════════════════════════════════════════════════════════════════
        'flow/vp_face_lock': {
            title: '🔒 Khóa Khuôn Mặt',
            icon: '🔒',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh giữ khuôn mặt', placeholder: '' },
            ],
            promptKey: 'FACE_CONSISTENCY',
        },
        'flow/vp_framing_lock': {
            title: '📐 Khóa Khung Hình & Zoom',
            icon: '📐',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh giữ khung hình', placeholder: '' },
            ],
            promptKey: 'FRAMING_LOCK',
        },
        'flow/vp_ff_style': {
            title: '🎮 Phong Cách FreeFire',
            icon: '🎮',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh ép style game', placeholder: '' },
            ],
            promptKey: 'FF_STYLE',
        },
        'flow/vp_body_anatomy': {
            title: '🦴 Cơ Thể & Giải Phẫu',
            icon: '🦴',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh ép form cơ thể', placeholder: '' },
            ],
            promptKey: 'BODY_ANATOMY',
        },
        'flow/vp_outfit_header': {
            title: '👗 Lệnh Thay Trang Phục',
            icon: '👗',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh chính thay đồ', placeholder: '' },
            ],
            promptKey: 'OUTFIT_HEADER',
        },
        'flow/vp_slot_template': {
            title: '🧩 Mẫu Tách Slot',
            icon: '🧩',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'slot', type: 'select', label: 'Chọn Slot', options: [
                    { value: 'top_inner', label: '👕 Áo trong' },
                    { value: 'top_outer', label: '🧥 Áo ngoài' },
                    { value: 'jacket', label: '🧥 Áo khoác' },
                    { value: 'bottom', label: '👖 Quần' },
                    { value: 'footwear', label: '👟 Giày' },
                    { value: 'hair', label: '💇 Tóc' },
                    { value: 'glasses', label: '🕶️ Kính' },
                    { value: 'gloves', label: '🧤 Bao tay' },
                    { value: 'belt', label: '⚡ Thắt lưng' },
                    { value: 'scarf', label: '🧣 Khăn quàng' },
                ]},
                { id: 'prompt', type: 'textarea', label: 'Lệnh tách slot', placeholder: '' },
            ],
            promptKey: 'SLOT_EXTRACTION',
        },
        'flow/vp_coherence': {
            title: '🎨 Quy Tắc Hài Hòa',
            icon: '🎨',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh hài hòa tổng thể', placeholder: '' },
            ],
            promptKey: 'COHERENCE',
        },
        'flow/vp_color_preserve': {
            title: '🎨 Giữ Màu Sắc & Họa Tiết',
            icon: '🎨',
            category: 'prompt_studio',
            width: 360,
            inputs: [],
            outputs: [{ id: 'prompt', label: 'Prompt', type: 'text' }],
            fields: [
                { id: 'prompt', type: 'textarea', label: 'Lệnh giữ nguyên màu/hoạ tiết', placeholder: '' },
            ],
            promptKey: 'COLOR_PRESERVE',
        },
        'flow/vp_assembler': {
            title: '⚡ Bộ Ghép Pipeline',
            icon: '⚡',
            category: 'prompt_studio',
            width: 360,
            inputs: [
                { id: 'p1', label: 'Khuôn Mặt', type: 'text' },
                { id: 'p2', label: 'Style Game', type: 'text' },
                { id: 'p3', label: 'Khung Hình', type: 'text' },
                { id: 'p4', label: 'Cơ Thể', type: 'text' },
                { id: 'p5', label: 'Thay Đồ', type: 'text' },
                { id: 'p6', label: 'Hài Hòa', type: 'text' },
                { id: 'p7', label: 'Giữ Màu', type: 'text' },
            ],
            outputs: [{ id: 'final', label: 'Prompt Cuối', type: 'text' }],
            fields: [],
        },
    },

    // ─── Giá trị prompt mặc định (từ prompt-engine.js) ────────────────────
    defaultPrompts: {
        FACE_CONSISTENCY: `[BẮT BUỘC — GIỮ NGUYÊN KHUÔN MẶT]
Khuôn mặt nhân vật là danh tính TUYỆT ĐỐI. AI PHẢI:
- Giữ CHÍNH XÁC cấu trúc khuôn mặt: hình dáng hàm, gò má, cằm
- Giữ CHÍNH XÁC mắt: hình dạng, kích thước, màu, khoảng cách, lông mày
- Giữ CHÍNH XÁC mũi: sống mũi, đầu mũi, lỗ mũi
- Giữ CHÍNH XÁC miệng: hình môi, độ dày, màu môi
- Giữ nguyên tông da, vết sẹo, nốt ruồi, đặc điểm riêng
- Giữ nguyên biểu cảm khuôn mặt và góc nghiêng đầu
- Bất kỳ thay đổi nào làm khác khuôn mặt = THẤT BẠI
KHUÔN MẶT LÀ BẤT KHẢ XÂM PHẠM — KHÔNG ĐƯỢC thay đổi dù chỉ "cải thiện" nhẹ`,

        FRAMING_LOCK: `[BẮT BUỘC — GIỮ ĐÚNG KHUNG HÌNH VÀ ZOOM]
PHẢI dùng [ẢNH NHÂN VẬT GỐC] làm canvas chính xác.
- KHÔNG tạo nhân vật mới từ đầu.
- Đầu ra PHẢI giữ CHÍNH XÁC cùng crop, frame, mức zoom, khoảng cách camera, và kích thước với ảnh gốc.
- Nếu ảnh gốc là toàn thân → đầu ra PHẢI là toàn thân. KHÔNG ZOOM VÀO quần áo hay thân trên.`,

        FF_STYLE: `[BẮT BUỘC — ĐỒNG BỘ PHONG CÁCH GAME]
TẤT CẢ trang phục PHẢI được render theo phong cách 3D game FreeFire, bất kể ảnh tham chiếu là loại gì.
Nếu ảnh tham chiếu là ảnh thật hoặc anime:
- Chuyển đổi thiết kế quần áo SANG phong cách render 3D FreeFire
- Áp dụng shader chất liệu game: PBR metallic, fabric subsurface, leather gloss
- Dùng ánh sáng đặc trưng FreeFire: rim light mạnh, ambient occlusion, fill mềm
- GIỮ THIẾT KẾ trang phục từ reference nhưng CHUYỂN ĐỔI style render
- Texture phải giống asset game high-poly, KHÔNG phải ảnh chụp
- Màu sắc hơi bão hòa hơn đời thật
Kết quả cuối PHẢI giống render nhân vật FreeFire chính thức, KHÔNG phải chỉnh ảnh thường.`,

        BODY_ANATOMY: `[RÀNG BUỘC CƠ THỂ]
Trang phục PHẢI vừa vặn với cơ thể nhân vật:
- Chiều rộng vai và độ dài tay → quyết định fit tay áo
- Tỷ lệ thân (ngực, eo, hông) → quyết định draping áo/quần
- Độ dài chân và tư thế → quyết định dáng quần/váy và vị trí giày
- Tư thế (POSE) hiện tại PHẢI được giữ nguyên hoàn toàn
- Vật lý vải phải phản ứng tự nhiên với tư thế (trọng lực, căng, nén)
- KHÔNG xuyên qua cơ thể — quần áo phải bọc quanh body tự nhiên
- Đúng layering: trong nằm dưới ngoài, không bị nhấp nháy Z-fighting
Dùng ảnh nhân vật gốc làm body reference tuyệt đối.`,

        OUTFIT_HEADER: `[THAY TRANG PHỤC THEO MODULE]
Thay trang phục nhân vật theo các thông số component bên dưới.
Mỗi component nhắm vào một vùng cơ thể cụ thể. Áp dụng TẤT CẢ component cùng lúc.
Giữ nguyên khuôn mặt, danh tính, tư thế, tỷ lệ cơ thể, nền, và đặc biệt là MỨC ZOOM/KHUNG HÌNH KHÔNG ĐỔI.`,

        COHERENCE: `[QUY TẮC HÀI HÒA]
Tất cả component trang phục phải phối hợp thành một bộ đồ đồng bộ về thị giác.
Màu sắc, chất liệu, và phong cách phải hài hòa giữa các slot.
Kết quả cuối phải trông như một bộ trang phục được thiết kế có chủ đích — KHÔNG phải mix ngẫu nhiên.`,

        COLOR_PRESERVE: `[BẮT BUỘC — GIỮ CHÍNH XÁC MÀU SẮC VÀ HỌA TIẾT]
Khi có ảnh tham chiếu cho bất kỳ slot nào:
- Khớp CHÍNH XÁC màu sắc: hue, saturation, brightness phải đúng
- MÀU ĐỎ phải giữ ĐỎ — KHÔNG chuyển sang đen, nâu đậm, hay maroon
- MÀU TRẮNG phải giữ TRẮNG — KHÔNG chuyển sang xám hay kem
- Giữ TẤT CẢ họa tiết: sọc, logo, print, thêu, texture, hoa văn
- Nếu reference có logo/chữ → tái tạo trung thực đúng vị trí và tỷ lệ
- Chất liệu phải giống: bóng giữ bóng, mờ giữ mờ, láng giữ láng
- KHÔNG "tái diễn giải nghệ thuật" — giữ màu và họa tiết CHÍNH XÁC
- Khi nghi ngờ về màu → LUÔN chọn phiên bản sáng hơn, bão hòa hơn khớp với reference`,
    },

    // ─── Initialize ───────────────────────────────────────────────────────
    init() {
        this.canvasEl = document.getElementById('flow-canvas');
        this.canvas = document.getElementById('flow-canvas-container');
        if (!this.canvasEl || !this.canvas) return;

        this._setupEventListeners();

        // Load saved prompt overrides
        this._loadPromptOverrides();

        this.render();
        console.log('[FlowEditor] Initialized');
    },

    // ─── Prompt Override System ───────────────────────────────────────────
    _loadPromptOverrides() {
        try {
            const saved = localStorage.getItem('nanobana_prompt_overrides');
            if (saved) {
                const overrides = JSON.parse(saved);
                Object.assign(this.defaultPrompts, overrides);
                console.log('[FlowEditor] Loaded prompt overrides from localStorage');
            }
        } catch (e) {}
    },

    savePromptOverrides() {
        // Collect all VP node prompt values
        const overrides = {};
        for (const node of this.nodes) {
            const typeDef = this.nodeTypes[node.type];
            if (typeDef && typeDef.promptKey && node.data.prompt) {
                overrides[typeDef.promptKey] = node.data.prompt;
            }
            // Special: slot extraction prompts are keyed by slot
            if (typeDef && typeDef.promptKey === 'SLOT_EXTRACTION' && node.data.prompt && node.data.slot) {
                if (!overrides.SLOT_OVERRIDES) overrides.SLOT_OVERRIDES = {};
                overrides.SLOT_OVERRIDES[node.data.slot] = node.data.prompt;
            }
        }

        localStorage.setItem('nanobana_prompt_overrides', JSON.stringify(overrides));
        this.defaultPrompts = { ...this.defaultPrompts, ...overrides };

        app.showToast('✅ Prompt đã lưu! Visual tab sẽ dùng prompt mới.', 'success');
        console.log('[FlowEditor] Prompt overrides saved:', Object.keys(overrides));
    },

    getPromptOverride(key) {
        return this.defaultPrompts[key] || '';
    },

    getSlotOverride(slotKey) {
        try {
            const saved = localStorage.getItem('nanobana_prompt_overrides');
            if (saved) {
                const overrides = JSON.parse(saved);
                if (overrides.SLOT_OVERRIDES && overrides.SLOT_OVERRIDES[slotKey]) {
                    return overrides.SLOT_OVERRIDES[slotKey];
                }
            }
        } catch(e) {}
        return null;
    },

    // ─── Load Visual Pipeline Preset ──────────────────────────────────────
    loadVisualPipeline() {
        this.nodes = [];
        this.connections = [];
        this.nextId = 100;

        // Create prompt nodes
        const nodeConfigs = [
            { type: 'flow/vp_face_lock',    x: 50,  y: 30,   key: 'FACE_CONSISTENCY' },
            { type: 'flow/vp_ff_style',     x: 50,  y: 320,  key: 'FF_STYLE' },
            { type: 'flow/vp_framing_lock', x: 50,  y: 610,  key: 'FRAMING_LOCK' },
            { type: 'flow/vp_body_anatomy', x: 50,  y: 900,  key: 'BODY_ANATOMY' },
            { type: 'flow/vp_outfit_header',x: 430, y: 30,   key: 'OUTFIT_HEADER' },
            { type: 'flow/vp_coherence',    x: 430, y: 320,  key: 'COHERENCE' },
            { type: 'flow/vp_color_preserve',x: 430, y: 610, key: 'COLOR_PRESERVE' },
            { type: 'flow/vp_assembler',    x: 850, y: 200,  key: null },
        ];

        const createdIds = [];
        for (const cfg of nodeConfigs) {
            const node = this.addNode(cfg.type, cfg.x, cfg.y);
            if (cfg.key && node) {
                node.data.prompt = this.defaultPrompts[cfg.key] || '';
            }
            createdIds.push(node ? node.id : null);
        }

        // Connect all prompt nodes to the assembler
        const assemblerId = createdIds[7];
        const portIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
        for (let i = 0; i < 7; i++) {
            if (createdIds[i] && assemblerId) {
                this.addConnection(createdIds[i], 'prompt', assemblerId, portIds[i]);
            }
        }

        this.render();
        this.zoomFit();
        app.showToast('📋 Visual Pipeline đã tải! Chỉnh prompt rồi bấm "💾 Lưu Prompt"', 'info');
    },

    // ─── Event Listeners ──────────────────────────────────────────────────
    _setupEventListeners() {
        const container = this.canvas;

        container.addEventListener('mousedown', (e) => {
            if (e.target.closest('.flow-context-menu')) return;
            this.closeContextMenu();

            if (e.button === 1 || (e.button === 0 && (e.target === container || e.target.classList.contains('flow-canvas')))) {
                this.isPanning = true;
                this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
                container.classList.add('dragging');
                e.preventDefault();
                return;
            }

            if (e.target === container || e.target === this.canvasEl) {
                this.selectedNodeId = null;
                this.render();
            }
        });

        container.addEventListener('mousemove', (e) => {
            if (this.isPanning && this.panStart) {
                this.panX = e.clientX - this.panStart.x;
                this.panY = e.clientY - this.panStart.y;
                this._applyTransform();
                return;
            }

            if (this.dragging) {
                const node = this.nodes.find(n => n.id === this.dragging.nodeId);
                if (node) {
                    node.x = (e.clientX - this.canvas.getBoundingClientRect().left - this.panX) / this.zoom - this.dragging.offsetX;
                    node.y = (e.clientY - this.canvas.getBoundingClientRect().top - this.panY) / this.zoom - this.dragging.offsetY;
                    this.render();
                }
                return;
            }

            if (this.connecting) {
                this._tempConnEnd = {
                    x: (e.clientX - this.canvas.getBoundingClientRect().left - this.panX) / this.zoom,
                    y: (e.clientY - this.canvas.getBoundingClientRect().top - this.panY) / this.zoom,
                };
                this._renderConnections();
            }
        });

        container.addEventListener('mouseup', (e) => {
            this.isPanning = false;
            this.panStart = null;
            container.classList.remove('dragging');
            this.dragging = null;
            if (this.connecting) {
                this.connecting = null;
                this._tempConnEnd = null;
                this._renderConnections();
            }
        });

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.2, Math.min(3, this.zoom * delta));
            const rect = container.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            this.panX = mx - (mx - this.panX) * (newZoom / this.zoom);
            this.panY = my - (my - this.panY) * (newZoom / this.zoom);
            this.zoom = newZoom;
            this._applyTransform();
        }, { passive: false });

        container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const x = (e.clientX - this.canvas.getBoundingClientRect().left - this.panX) / this.zoom;
            const y = (e.clientY - this.canvas.getBoundingClientRect().top - this.panY) / this.zoom;
            this.showContextMenu(e.clientX, e.clientY, x, y);
        });
    },

    _applyTransform() {
        if (this.canvasEl) {
            this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
        }
        this._renderConnections();
        const zoomDisplay = document.getElementById('flow-zoom-display');
        if (zoomDisplay) zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`;
    },

    // ─── Add Node ─────────────────────────────────────────────────────────
    addNode(typeId, x = 200, y = 200) {
        const typeDef = this.nodeTypes[typeId];
        if (!typeDef) return null;

        const node = {
            id: 'flow_' + (this.nextId++),
            type: typeId,
            x, y,
            data: {},
            previewUrl: null,
            previewBase64: null,
            status: 'idle',
        };

        for (const field of typeDef.fields) {
            if (field.type === 'select' && field.options && field.options.length > 0) {
                node.data[field.id] = field.options[0].value;
            } else {
                node.data[field.id] = '';
            }
        }

        this.nodes.push(node);
        this.selectedNodeId = node.id;
        // Update node count
        const countEl = document.getElementById('flow-node-count');
        if (countEl) countEl.textContent = `${this.nodes.length} nodes`;
        this.render();
        return node;
    },

    removeNode(nodeId) {
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
        this.connections = this.connections.filter(c => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId);
        if (this.selectedNodeId === nodeId) this.selectedNodeId = null;
        const countEl = document.getElementById('flow-node-count');
        if (countEl) countEl.textContent = `${this.nodes.length} nodes`;
        this.render();
    },

    // ─── Connections ──────────────────────────────────────────────────────
    addConnection(fromNodeId, fromPortId, toNodeId, toPortId) {
        this.connections = this.connections.filter(c =>
            !(c.to.nodeId === toNodeId && c.to.portId === toPortId)
        );
        this.connections.push({
            id: 'conn_' + (this.nextId++),
            from: { nodeId: fromNodeId, portId: fromPortId },
            to: { nodeId: toNodeId, portId: toPortId },
        });
        this._renderConnections();
    },

    // ─── Render ───────────────────────────────────────────────────────────
    render() {
        if (!this.canvasEl) return;

        const existingNodes = this.canvasEl.querySelectorAll('.flow-node');
        existingNodes.forEach(el => el.remove());

        for (const node of this.nodes) {
            const el = this._createNodeElement(node);
            this.canvasEl.appendChild(el);
        }

        this._renderConnections();
    },

    _createNodeElement(node) {
        const typeDef = this.nodeTypes[node.type];
        const el = document.createElement('div');
        el.className = `flow-node ${node.id === this.selectedNodeId ? 'selected' : ''} ${node.status === 'running' ? 'running' : ''} ${node.status === 'error' ? 'error' : ''}`;
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.style.width = typeDef.width + 'px';
        el.dataset.nodeId = node.id;

        // Category-based border color accent
        if (typeDef.category === 'prompt_studio') {
            el.style.borderColor = 'rgba(167,139,250,0.3)';
        }

        // Header
        const header = document.createElement('div');
        header.className = 'flow-node-header';
        header.innerHTML = `
            <span class="node-icon">${typeDef.icon}</span>
            <span class="node-title">${typeDef.title}</span>
            <button class="node-delete" onclick="FlowEditor.removeNode('${node.id}')" title="Xóa">✕</button>
        `;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.node-delete')) return;
            e.stopPropagation();
            this.selectedNodeId = node.id;
            const rect = this.canvas.getBoundingClientRect();
            this.dragging = {
                nodeId: node.id,
                offsetX: (e.clientX - rect.left - this.panX) / this.zoom - node.x,
                offsetY: (e.clientY - rect.top - this.panY) / this.zoom - node.y,
            };
            this.render();
        });

        el.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'flow-node-body';

        // Preview
        if (typeDef.hasPreview) {
            const preview = document.createElement('div');
            preview.className = 'flow-node-preview';
            if (node.previewUrl) {
                preview.innerHTML = `<img src="${node.previewUrl}" alt="Preview" />`;
            } else {
                preview.innerHTML = `
                    <div class="preview-placeholder">
                        <span class="placeholder-icon">${typeDef.icon}</span>
                        <span>${node.status === 'running' ? 'Đang xử lý...' : 'No output yet'}</span>
                    </div>
                `;
            }
            body.appendChild(preview);

            if (node.status === 'running') {
                const prog = document.createElement('div');
                prog.className = 'flow-node-progress';
                prog.innerHTML = '<div class="flow-node-progress-fill" style="width:60%;"></div>';
                body.appendChild(prog);
            }
        }

        // Fields
        for (const field of typeDef.fields) {
            const fieldEl = document.createElement('div');
            fieldEl.className = 'flow-field';

            if (field.type === 'textarea') {
                const rows = (node.data[field.id] || '').split('\n').length;
                const displayRows = Math.max(3, Math.min(12, rows));
                fieldEl.innerHTML = `
                    <label>${field.label}</label>
                    <textarea rows="${displayRows}" placeholder="${field.placeholder || ''}" 
                        oninput="FlowEditor.updateField('${node.id}', '${field.id}', this.value)">${node.data[field.id] || ''}</textarea>
                `;
            } else if (field.type === 'select') {
                const opts = field.options.map(o =>
                    `<option value="${o.value}" ${node.data[field.id] === o.value ? 'selected' : ''}>${o.label}</option>`
                ).join('');
                fieldEl.innerHTML = `
                    <label>${field.label}</label>
                    <select onchange="FlowEditor.updateField('${node.id}', '${field.id}', this.value)">${opts}</select>
                `;
            } else if (field.type === 'button') {
                fieldEl.innerHTML = `
                    <label>${field.label}</label>
                    <button class="field-btn" onclick="FlowEditor.handleFieldAction('${node.id}', '${field.id}')">${field.buttonText || 'Action'}</button>
                `;
            }

            fieldEl.addEventListener('mousedown', e => e.stopPropagation());
            body.appendChild(fieldEl);
        }

        el.appendChild(body);

        // Ports (Input)
        let portYOffset = typeDef.hasPreview ? 60 : 45;
        if (typeDef.category === 'prompt_studio' && !typeDef.hasPreview) portYOffset = 45;

        for (let i = 0; i < typeDef.inputs.length; i++) {
            const port = typeDef.inputs[i];
            const portEl = document.createElement('div');
            const yPos = portYOffset + i * 28;
            portEl.className = `flow-port input port-${port.type}`;
            portEl.style.left = '-7px';
            portEl.style.top = yPos + 'px';
            portEl.dataset.nodeId = node.id;
            portEl.dataset.portId = port.id;
            portEl.dataset.portDir = 'input';
            portEl.dataset.portType = port.type;

            const isConn = this.connections.some(c => c.to.nodeId === node.id && c.to.portId === port.id);
            if (isConn) portEl.classList.add('connected');

            const labelEl = document.createElement('span');
            labelEl.className = 'flow-port-label';
            labelEl.style.left = '12px';
            labelEl.style.top = (yPos + 2) + 'px';
            labelEl.textContent = port.label;

            this._setupPortEvents(portEl, node, port, 'input');
            el.appendChild(portEl);
            el.appendChild(labelEl);
        }

        // Ports (Output)
        for (let i = 0; i < typeDef.outputs.length; i++) {
            const port = typeDef.outputs[i];
            const portEl = document.createElement('div');
            const yPos = portYOffset + i * 28;
            portEl.className = `flow-port output port-${port.type}`;
            portEl.style.right = '-7px';
            portEl.style.top = yPos + 'px';
            portEl.dataset.nodeId = node.id;
            portEl.dataset.portId = port.id;
            portEl.dataset.portDir = 'output';
            portEl.dataset.portType = port.type;

            const isConn = this.connections.some(c => c.from.nodeId === node.id && c.from.portId === port.id);
            if (isConn) portEl.classList.add('connected');

            const labelEl = document.createElement('span');
            labelEl.className = 'flow-port-label';
            labelEl.style.right = '12px';
            labelEl.style.top = (yPos + 2) + 'px';
            labelEl.textContent = port.label;

            this._setupPortEvents(portEl, node, port, 'output');
            el.appendChild(portEl);
            el.appendChild(labelEl);
        }

        return el;
    },

    _setupPortEvents(portEl, node, port, direction) {
        portEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (direction === 'output') {
                this.connecting = { nodeId: node.id, portId: port.id, portType: port.type, direction: 'output' };
            }
        });
        portEl.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            if (this.connecting && direction === 'input' && this.connecting.nodeId !== node.id) {
                this.addConnection(this.connecting.nodeId, this.connecting.portId, node.id, port.id);
                this.connecting = null;
                this._tempConnEnd = null;
                this.render();
            }
        });
    },

    // ─── Render Connections (SVG) ─────────────────────────────────────────
    _renderConnections() {
        let svg = this.canvasEl.querySelector('.flow-connections-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('flow-connections-svg');
            svg.style.width = '10000px';
            svg.style.height = '10000px';
            this.canvasEl.prepend(svg);
        }
        svg.innerHTML = '';

        for (const conn of this.connections) {
            const fromPos = this._getPortPosition(conn.from.nodeId, conn.from.portId, 'output');
            const toPos = this._getPortPosition(conn.to.nodeId, conn.to.portId, 'input');
            if (!fromPos || !toPos) continue;

            const fromNode = this.nodes.find(n => n.id === conn.from.nodeId);
            const typeDef = fromNode ? this.nodeTypes[fromNode.type] : null;
            const outputPort = typeDef?.outputs.find(p => p.id === conn.from.portId);
            const connType = outputPort?.type || 'text';

            const path = this._createBezierPath(fromPos, toPos);
            path.classList.add('flow-connection', `conn-${connType}`);
            svg.appendChild(path);
        }

        if (this.connecting && this._tempConnEnd) {
            const fromPos = this._getPortPosition(this.connecting.nodeId, this.connecting.portId, 'output');
            if (fromPos) {
                const path = this._createBezierPath(fromPos, this._tempConnEnd);
                path.classList.add('flow-connection-temp');
                svg.appendChild(path);
            }
        }
    },

    _getPortPosition(nodeId, portId, direction) {
        const nodeEl = this.canvasEl.querySelector(`[data-node-id="${nodeId}"]`);
        if (!nodeEl) return null;
        const portEl = nodeEl.querySelector(`.flow-port[data-port-id="${portId}"][data-port-dir="${direction}"]`);
        if (!portEl) return null;

        const node = this.nodes.find(n => n.id === nodeId);
        const typeDef = this.nodeTypes[node.type];
        const portTop = parseInt(portEl.style.top) || 0;
        const x = direction === 'output' ? node.x + typeDef.width : node.x;
        const y = node.y + portTop + 7;
        return { x, y };
    },

    _createBezierPath(from, to) {
        const dx = Math.abs(to.x - from.x) * 0.5;
        const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        return path;
    },

    // ─── Field Updates ────────────────────────────────────────────────────
    updateField(nodeId, fieldId, value) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) node.data[fieldId] = value;
    },

    handleFieldAction(nodeId, fieldId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        if (fieldId === 'upload') {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    node.previewBase64 = ev.target.result.split(',')[1];
                    node.previewUrl = ev.target.result;
                    node.data._imageData = node.previewBase64;
                    this.render();
                };
                reader.readAsDataURL(file);
            };
            input.click();
        }
    },

    // ─── Context Menu ─────────────────────────────────────────────────────
    showContextMenu(screenX, screenY, canvasX, canvasY) {
        this.closeContextMenu();
        const menu = document.createElement('div');
        menu.className = 'flow-context-menu';
        menu.style.left = screenX + 'px';
        menu.style.top = screenY + 'px';

        const categories = {
            'Đầu Vào': ['flow/prompt', 'flow/image_input', 'flow/face_ref'],
            'Xử Lý': ['flow/image_gen', 'flow/angle_control', 'flow/remove_bg'],
            'Đầu Ra': ['flow/composite', 'flow/output'],
            'Prompt Studio': ['flow/vp_face_lock', 'flow/vp_ff_style', 'flow/vp_framing_lock', 'flow/vp_body_anatomy', 'flow/vp_outfit_header', 'flow/vp_coherence', 'flow/vp_color_preserve', 'flow/vp_slot_template', 'flow/vp_assembler'],
        };

        for (const [catName, types] of Object.entries(categories)) {
            const label = document.createElement('div');
            label.className = 'menu-label';
            label.textContent = catName;
            menu.appendChild(label);

            for (const typeId of types) {
                const typeDef = this.nodeTypes[typeId];
                if (!typeDef) continue;
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.innerHTML = `<span class="menu-icon">${typeDef.icon}</span> ${typeDef.title}`;
                item.onclick = () => {
                    this.addNode(typeId, canvasX, canvasY);
                    this.closeContextMenu();
                };
                menu.appendChild(item);
            }

            const div = document.createElement('div');
            div.className = 'menu-divider';
            menu.appendChild(div);
        }

        document.body.appendChild(menu);
        this.contextMenu = menu;
        setTimeout(() => {
            document.addEventListener('click', this._closeContextMenuHandler = () => { this.closeContextMenu(); }, { once: true });
        }, 10);
    },

    closeContextMenu() {
        if (this.contextMenu) { this.contextMenu.remove(); this.contextMenu = null; }
    },

    // ─── Execute Flow ─────────────────────────────────────────────────────
    async executeFlow() {
        if (this.nodes.length === 0) {
            app.showToast('Flow trống! Thêm node bằng chuột phải.', 'warning');
            return;
        }

        const overlay = document.getElementById('flow-execution-overlay');
        if (overlay) overlay.classList.add('active');

        const order = this._topologicalSort();

        for (const nodeId of order) {
            const node = this.nodes.find(n => n.id === nodeId);
            if (!node) continue;
            node.status = 'running';
            this.render();

            try {
                await this._executeNode(node);
                node.status = 'done';
            } catch (err) {
                console.error(`[Flow] Error executing ${node.type}:`, err);
                node.status = 'error';
                app.showToast(`Lỗi: ${err.message}`, 'error');
            }
            this.render();
        }

        if (overlay) overlay.classList.remove('active');
        app.showToast('Flow hoàn tất!', 'success');
    },

    async _executeNode(node) {
        const typeDef = this.nodeTypes[node.type];
        const apiKey = localStorage.getItem('nanobana_api_key') || '';

        // Gather inputs
        const inputData = {};
        for (const conn of this.connections) {
            if (conn.to.nodeId === node.id) {
                const src = this.nodes.find(n => n.id === conn.from.nodeId);
                if (src) inputData[conn.to.portId] = { base64: src.previewBase64, url: src.previewUrl, text: src.data?.prompt || '' };
            }
        }

        // Prompt Studio nodes don't need execution
        if (typeDef.category === 'prompt_studio') return;

        switch (node.type) {
            case 'flow/prompt':
            case 'flow/image_input':
            case 'flow/face_ref':
                break; // Already have data

            case 'flow/image_gen': {
                let prompt = '';
                const promptConn = this.connections.find(c => c.to.nodeId === node.id && c.to.portId === 'prompt');
                if (promptConn) {
                    const pn = this.nodes.find(n => n.id === promptConn.from.nodeId);
                    if (pn) prompt = pn.data.prompt || '';
                }
                const refBase64 = inputData.ref_image?.base64;
                const model = node.data.model || 'pro';

                const resp = await fetch('/api/workflow/node/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                    body: JSON.stringify({
                        nodeConfig: { customPrompt: prompt, model, aspectRatio: '1:1', ffMode: true },
                        ...(refBase64 ? { imageData: [{ data: refBase64, mimeType: 'image/png' }] } : {}),
                    }),
                });
                const result = await resp.json();
                if (result.success && result.image) {
                    node.previewUrl = result.image.path;
                    const imgResp = await fetch(result.image.path);
                    const blob = await imgResp.blob();
                    node.previewBase64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
                } else throw new Error(result.error || 'Generation failed');
                break;
            }

            case 'flow/angle_control': {
                const src = inputData.image?.base64;
                if (!src) throw new Error('No source image');
                const angle = node.data.angle || 'a_front';
                const resp = await fetch('/api/workflow/node/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                    body: JSON.stringify({
                        nodeConfig: { customPrompt: `Render this exact character in A-Pose from the ${angle.replace('a_', '')} view. Maintain EXACT same outfit, face, body. Solid gray studio background. Generate EXACTLY ONE image.`, model: 'pro', aspectRatio: '1:1', ffMode: true },
                        imageData: [{ data: src, mimeType: 'image/png' }],
                    }),
                });
                const result = await resp.json();
                if (result.success && result.image) {
                    node.previewUrl = result.image.path;
                    const imgResp = await fetch(result.image.path);
                    const blob = await imgResp.blob();
                    node.previewBase64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
                }
                break;
            }

            case 'flow/remove_bg': {
                const src = inputData.image?.base64;
                if (!src) throw new Error('No source image');
                const resp = await fetch('/api/workflow/node/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                    body: JSON.stringify({
                        nodeConfig: { customPrompt: 'Remove the background completely. Make background fully transparent (alpha=0). Keep the character perfectly intact with clean edges. Output PNG with transparent background.', model: 'pro', aspectRatio: '1:1' },
                        imageData: [{ data: src, mimeType: 'image/png' }],
                    }),
                });
                const result = await resp.json();
                if (result.success && result.image) {
                    node.previewUrl = result.image.path;
                    const imgResp = await fetch(result.image.path);
                    const blob = await imgResp.blob();
                    node.previewBase64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
                }
                break;
            }

            case 'flow/output': {
                const src = inputData.image?.base64;
                const srcUrl = inputData.image?.url;
                if (src) { node.previewBase64 = src; node.previewUrl = srcUrl; }
                break;
            }
        }
    },

    _topologicalSort() {
        const inDeg = {};
        for (const n of this.nodes) inDeg[n.id] = 0;
        for (const c of this.connections) { if (inDeg[c.to.nodeId] !== undefined) inDeg[c.to.nodeId]++; }
        const queue = Object.keys(inDeg).filter(id => inDeg[id] === 0);
        const result = [];
        while (queue.length > 0) {
            const cur = queue.shift();
            result.push(cur);
            for (const c of this.connections) {
                if (c.from.nodeId === cur) { inDeg[c.to.nodeId]--; if (inDeg[c.to.nodeId] === 0) queue.push(c.to.nodeId); }
            }
        }
        return result;
    },

    // ─── Zoom Controls ────────────────────────────────────────────────────
    zoomIn() { this.zoom = Math.min(3, this.zoom * 1.2); this._applyTransform(); },
    zoomOut() { this.zoom = Math.max(0.2, this.zoom / 1.2); this._applyTransform(); },
    zoomFit() {
        if (this.nodes.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of this.nodes) {
            const td = this.nodeTypes[n.type];
            minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + (td?.width || 240)); maxY = Math.max(maxY, n.y + 400);
        }
        const rect = this.canvas.getBoundingClientRect();
        const padding = 80;
        const w = maxX - minX + padding * 2;
        const h = maxY - minY + padding * 2;
        this.zoom = Math.min(rect.width / w, rect.height / h, 1.5);
        this.panX = rect.width / 2 - (minX + (maxX - minX) / 2) * this.zoom;
        this.panY = rect.height / 2 - (minY + (maxY - minY) / 2) * this.zoom;
        this._applyTransform();
    },

    clearFlow() {
        if (!confirm('Xóa toàn bộ Flow?')) return;
        this.nodes = []; this.connections = []; this.selectedNodeId = null;
        const countEl = document.getElementById('flow-node-count');
        if (countEl) countEl.textContent = '0 nodes';
        this.render();
    },

    downloadOutput() {
        const out = this.nodes.find(n => n.type === 'flow/output' && n.previewUrl);
        if (!out) { app.showToast('Chưa có output!', 'warning'); return; }
        const a = document.createElement('a');
        a.href = out.previewUrl;
        a.download = `flow_output_${Date.now()}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    },
};
