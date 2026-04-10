/**
 * Visual Layer Mode v3.0 (Visual Closet)
 * 3-group system: Face / Outfit / Accessory
 * Drag-sort layer ordering, expanded slots, redesigned cache
 */

window.visualMode = {
    // ─── SLOT DEFINITIONS ────────────────────────────────────────────────
    SLOT_GROUPS: {
        face: {
            label: '👤 Model Mặt',
            slots: [
                { key: 'hair',    name: 'Tóc',        icon: '💇' },
                { key: 'tattoo',  name: 'Hình xăm',   icon: '🔥' },
                { key: 'glasses', name: 'Kính',        icon: '🕶️' },
                { key: 'earring', name: 'Khuyên tai',  icon: '💎' },
                { key: 'beard',   name: 'Râu',         icon: '🧔' },
            ]
        },
        outfit: {
            label: '👗 Mặc Đồ',
            slots: [
                { key: 'top_inner', name: 'Áo trong',       icon: '👕' },
                { key: 'top_outer', name: 'Áo ngoài',       icon: '🧥' },
                { key: 'jacket',    name: 'Áo khoác',       icon: '🧥' },
                { key: 'bottom',    name: 'Quần',           icon: '👖' },
                { key: 'skirt',     name: 'Váy',            icon: '👗' },
                { key: 'stockings', name: 'Tất',            icon: '🧦' },
                { key: 'footwear',  name: 'Giày',           icon: '👟' },
                { key: 'onepiece',  name: 'Bộ liền thân',   icon: '👗' },
            ]
        },
        accessory: {
            label: '💍 Phụ Kiện',
            slots: [
                { key: 'necklace', name: 'Vòng cổ',    icon: '📿' },
                { key: 'bracelet', name: 'Vòng tay',   icon: '⌚' },
                { key: 'gloves',   name: 'Bao tay',    icon: '🧤' },
                { key: 'scarf',    name: 'Khăn quàng', icon: '🧣' },
                { key: 'belt',     name: 'Thắt lưng',  icon: '⚡' },
            ]
        }
    },

    // ─── LAYER HIERARCHY (deterministic ordering) ────────────────────────
    // Lower index = rendered first (bottom of stack), higher = on top
    LAYER_HIERARCHY: [
        'stockings', 'footwear', 'bottom', 'skirt', 'onepiece',
        'top_inner', 'top_outer', 'jacket',
        'belt', 'scarf', 'gloves',
        'necklace', 'bracelet',
        'glasses', 'earring',
        'hair', 'tattoo', 'beard',
    ],

    // ─── STATE ───────────────────────────────────────────────────────────
    currentGroup: 'outfit',       // Active mega-tab group
    currentSlotFilter: null,      // Which sub-slot to show assets for (e.g. 'top_inner')
    assets: [],
    equippedSlots: {},            // { slotKey: { id, thumbUrl, name, visible, base64 } }
    layerOrder: [],               // Ordered list of equipped slot keys (for drag-sort)
    defaultMannequinPath: '/images/placeholders/mannequin_default.png',
    currentBaseModelStr: null,

    // Incremental rendering state
    lastRenderedImage: null,       // base64 data URL of last successful render
    lastRenderedSlots: [],         // slot keys that were included in lastRenderedImage
    _lastNewSlot: null,            // the slot that was just added (for incremental detection)
    _forceFullRender: false,       // flag to force full re-render

    // LiteGraph Node References (hidden, bridges visual → node system)
    nodes: { input: null, component: null, output: null },

    debounceTimer: null,
    previewCache: new Map(),
    dragSrcIndex: null,            // For layer drag-sort

    // v3.1: Pixel degradation tracking
    incrementalEditCount: 0,       // How many incremental renders done since last full render
    lockedAspectRatio: null,       // Locked aspect ratio from initial base model upload

    // ─── SESSION CACHE ───────────────────────────────────────────────────
    saveSession() {
        if (!this.nodes.component) return;
        try {
            const cacheData = {
                currentBaseModelStr: this.currentBaseModelStr,
                layerOrder: this.layerOrder,
                equippedSlots: this.equippedSlots,
                nodeProperties: this.nodes.component.properties
            };
            localStorage.setItem('nanobana_visual_cache', JSON.stringify(cacheData));
        } catch (e) {
            console.warn('Cannot save session due to quota', e);
        }
    },

    loadSession() {
        try {
            const cached = localStorage.getItem('nanobana_visual_cache');
            if (cached) {
                const data = JSON.parse(cached);
                if (data.currentBaseModelStr) {
                    this.currentBaseModelStr = data.currentBaseModelStr;
                    this._detectAndSetAspectRatio(this.currentBaseModelStr);
                    if (this.nodes.input) this.nodes.input.properties.imageData = this.currentBaseModelStr.split(',')[1];
                    document.getElementById('base-model-thumb-img').src = this.currentBaseModelStr;
                    document.getElementById('base-model-thumb-img').style.display = 'block';
                    document.getElementById('base-model-name').textContent = 'Phiên cũ';
                    document.getElementById('visual-preview-img').src = this.currentBaseModelStr;
                }
                if (data.layerOrder) this.layerOrder = data.layerOrder;
                if (data.equippedSlots) this.equippedSlots = data.equippedSlots;
                if (data.nodeProperties && this.nodes.component) {
                    this.nodes.component.properties = data.nodeProperties;
                }
                this.renderLayerStack();
                // triggerRender will fire when the session initiates fully later
            } else {
                this.loadDefaultMannequin(this.nodes.input);
            }
        } catch (e) {
            console.error('Session load failed:', e);
            this.loadDefaultMannequin(this.nodes.input);
        }
    },

    // ─── INIT ────────────────────────────────────────────────────────────
    init() {
        console.log('[VisualMode v3.0] Initializing...');
        // Build equippedSlots from all groups
        for (const group of Object.values(this.SLOT_GROUPS)) {
            for (const s of group.slots) {
                this.equippedSlots[s.key] = null;
            }
        }
        this.setupEventListeners();
        this.switchGroup('outfit');
        this.initWorkspace();
        this.renderLayerStack();
    },

    setupEventListeners() {
        const originalExecute = app.nodeEditor.executeWorkflow.bind(app.nodeEditor);
        app.nodeEditor.executeWorkflow = async () => {
            const overlay = document.getElementById('visual-loading-overlay');
            if (overlay) overlay.style.display = 'flex';
            try {
                await originalExecute();
                const resultUrl = document.getElementById('node-output-img').src;
                if (resultUrl && !resultUrl.endsWith('.html')) {
                    document.getElementById('visual-preview-img').src = resultUrl;
                }
            } finally {
                if (overlay) overlay.style.display = 'none';
            }
        };
    },

    initWorkspace() {
        const graph = app.nodeEditor.graph;
        graph.clear();

        const inputNode = LiteGraph.createNode('ff/image_input');
        inputNode.pos = [100, 200];
        graph.add(inputNode);

        const compNode = LiteGraph.createNode('ff/component_selector');
        compNode.pos = [400, 150];
        compNode.properties.isOnePiece = false;
        compNode.properties.preserveFace = true;
        // Initialize properties for ALL slots
        for (const group of Object.values(this.SLOT_GROUPS)) {
            for (const s of group.slots) {
                if (!compNode.properties[s.key]) {
                    compNode.properties[s.key] = { enabled: false, description: '', referenceImage: null };
                }
                compNode.properties[s.key].enabled = false;
            }
        }
        graph.add(compNode);

        const outputNode = LiteGraph.createNode('ff/output');
        outputNode.pos = [800, 200];
        graph.add(outputNode);

        inputNode.connect(0, compNode, 0);
        compNode.connect(0, outputNode, 0);

        this.nodes.input = inputNode;
        this.nodes.component = compNode;
        this.nodes.output = outputNode;

        // Try load session, overrides default mannequin if exists
        this.loadSession();
    },

    _detectAndSetAspectRatio(dataUrl) {
        const img = new Image();
        img.onload = () => {
            const ratio = img.width / img.height;
            let targetRatio = '1:1';
            // Simple bucketing
            if (ratio > 1.5) targetRatio = '16:9';
            else if (ratio > 1.2) targetRatio = '3:2';
            else if (ratio > 1.1) targetRatio = '4:3';
            else if (ratio < 0.6) targetRatio = '9:16';
            else if (ratio < 0.7) targetRatio = '2:3';
            else if (ratio < 0.9) targetRatio = '3:4';
            
            // v3.1: Lock aspect ratio from base model
            this.lockedAspectRatio = targetRatio;

            if (this.nodes.component) {
                this.nodes.component.properties.aspectRatio = targetRatio;
                console.log('[VisualMode] Auto-detected & LOCKED aspect ratio:', targetRatio, 'from', img.width, 'x', img.height);
            }
        };
        img.src = dataUrl;
    },

    async loadDefaultMannequin(inputNode) {
        try {
            const res = await fetch(this.defaultMannequinPath);
            if (!res.ok) return;
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                inputNode.properties.imageData = base64;
                this.currentBaseModelStr = e.target.result;
                this._detectAndSetAspectRatio(e.target.result);
            };
            reader.readAsDataURL(blob);
        } catch (e) {
            console.error('Failed to load default mannequin:', e);
        }
    },

    // ─── BASE MODEL UPLOAD ───────────────────────────────────────────────
    uploadBaseModel() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target.result;
                const base64 = dataUrl.split(',')[1];
                this.currentBaseModelStr = dataUrl;
                this._detectAndSetAspectRatio(dataUrl);
                if (this.nodes.input) {
                    this.nodes.input.properties.imageData = base64;
                    this.nodes.input.properties.fileName = file.name;
                    this.nodes.input.setDirtyCanvas(true);
                }
                document.getElementById('base-model-thumb-img').src = dataUrl;
                document.getElementById('base-model-thumb-img').style.display = 'block';
                document.getElementById('base-model-name').textContent = file.name;
                document.getElementById('visual-preview-img').src = dataUrl; // Force update main preview
                // NOTE: Don't triggerRender() here — no outfit equipped yet, saves API quota
                this.saveSession();
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    changeModel(modelId) {
        if (!this.nodes.component) return;
        this.nodes.component.properties.model = modelId;
        app.showToast(`Đã chuyển sang model: ${modelId === 'pro' ? 'Pro' : 'Flash'}`, 'success');
        // NOTE: Don't auto-render on model switch — wait until user explicitly triggers
        this.previewCache.clear(); // Clear cache since model changed
        this.saveSession();
    },

    async uploadBaseModelFromUrl() {
        const url = prompt('Nhập đường dẫn ảnh nhân vật gốc (URL):');
        if (!url) return;
        try {
            app.showToast('Đang tải ảnh từ URL...', 'info');
            const res = await fetch(`/api/fetch-image?url=${encodeURIComponent(url)}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Lỗi tải ảnh');
            const dataUrl = `data:image/png;base64,${data.base64}`;
            this.currentBaseModelStr = dataUrl;
            this._detectAndSetAspectRatio(dataUrl);
            if (this.nodes.input) {
                this.nodes.input.properties.imageData = data.base64;
                this.nodes.input.setDirtyCanvas(true);
            }
            document.getElementById('base-model-thumb-img').src = dataUrl;
            document.getElementById('base-model-thumb-img').style.display = 'block';
            document.getElementById('base-model-name').textContent = 'URL Import';
            document.getElementById('visual-preview-img').src = dataUrl;
            app.showToast('Ảnh nhân vật đã được tải!', 'success');
            // NOTE: Don't triggerRender() here — saves API quota
            this.saveSession();
        } catch (e) {
            app.showToast('Lỗi tải ảnh: ' + e.message, 'error');
        }
    },

    // ─── GROUP & CATEGORY SWITCHING ──────────────────────────────────────
    switchGroup(groupKey) {
        this.currentGroup = groupKey;

        // Update mega-tab active states
        document.querySelectorAll('.mega-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.group === groupKey);
        });

        // Show sub-slots for this group
        const group = this.SLOT_GROUPS[groupKey];
        if (!group) return;

        const subContainer = document.getElementById('visual-sub-slots');
        subContainer.innerHTML = group.slots.map(s => {
            const equipped = this.equippedSlots[s.key];
            const isActive = this.currentSlotFilter === s.key;
            const badge = equipped ? ' ●' : '';
            return `<button class="sub-slot-btn ${isActive ? 'active' : ''} ${equipped ? 'equipped' : ''}"
                        data-slot="${s.key}" 
                        onclick="visualMode.switchSlotFilter('${s.key}')">
                        ${s.icon} ${s.name}${badge}
                    </button>`;
        }).join('');

        // Auto-select first slot if none selected in this group
        const firstSlot = group.slots[0].key;
        if (!this.currentSlotFilter || !group.slots.find(s => s.key === this.currentSlotFilter)) {
            this.switchSlotFilter(firstSlot);
        }
    },

    updateSlotDescription(desc) {
        if (!this.nodes.component || !this.currentSlotFilter) return;
        const slot = this.currentSlotFilter;
        if (!this.nodes.component.properties[slot]) {
            this.nodes.component.properties[slot] = { enabled: false, refCount: 0, description: '' };
        }
        
        const compProp = this.nodes.component.properties[slot];
        compProp.description = desc;
        
        // If there is description text, make sure the slot becomes equipped/visible
        if (desc && desc.trim().length > 0) {
            compProp.enabled = true;
            
            if (!this.equippedSlots[slot]) {
                // Determine slot definition for naming
                let slotName = slot;
                for (const group of Object.values(this.SLOT_GROUPS)) {
                    const found = group.slots.find(s => s.key === slot);
                    if (found) { slotName = found.name; break; }
                }
                
                // Add to internal state
                this.equippedSlots[slot] = { 
                    id: 'desc_only', 
                    thumbUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23333"/><text x="50%" y="50%" text-anchor="middle" font-size="10" fill="%23fff" dy=".3em">Text</text></svg>', 
                    name: '(Chỉ từ khóa)', 
                    visible: true 
                };
                
                this._insertLayerAtHierarchyPosition(slot);
                this.renderLayerStack();
                this.switchGroup(this.currentGroup); // refresh badge
            }
            
            // Auto trigger render because typing has stopped
            this.triggerRender();
        } else if (!compProp.referenceImage) {
            // Description cleared AND no image -> disable slot completely
            compProp.enabled = false;
            if (this.equippedSlots[slot] && this.equippedSlots[slot].id === 'desc_only') {
                this.removeEquip(slot);
            }
        }
        
        this.saveSession();
    },

    switchSlotFilter(slotKey) {
        this.currentSlotFilter = slotKey;

        // Update active state
        document.querySelectorAll('.sub-slot-btn').forEach(el => {
            el.classList.toggle('active', el.dataset.slot === slotKey);
        });

        // Find display name
        let slotName = slotKey;
        for (const group of Object.values(this.SLOT_GROUPS)) {
            const found = group.slots.find(s => s.key === slotKey);
            if (found) { slotName = `${found.icon} ${found.name}`; break; }
        }
        document.getElementById('current-category-name').textContent = slotName;

        // Sync description textarea
        const descInput = document.getElementById('slot-description-input');
        if (descInput && this.nodes.component) {
            const prop = this.nodes.component.properties[slotKey];
            descInput.value = (prop && prop.description) ? prop.description : '';
        }

        this.fetchAssets(slotKey);
    },

    // ─── ASSET GRID ──────────────────────────────────────────────────────
    async fetchAssets(slotKey) {
        const grid = document.getElementById('asset-grid');
        grid.innerHTML = '<div style="padding:20px;font-size:12px;color:#888;">Đang tải...</div>';
        try {
            const res = await fetch(`/api/components?slot=${slotKey}`);
            const data = await res.json();
            this.assets = data.components || [];
            this.renderAssets();
        } catch (err) {
            grid.innerHTML = '<div style="padding:20px;font-size:12px;color:red;">Lỗi tải dữ liệu</div>';
        }
    },

    renderAssets() {
        const grid = document.getElementById('asset-grid');
        if (!this.assets.length) {
            grid.innerHTML = '<div style="padding:20px;font-size:12px;color:#888;">Chưa có tài nguyên. Nhấn "File" hoặc "URL" để thêm.</div>';
            return;
        }
        grid.innerHTML = this.assets.map(asset => {
            const thumbUrl = asset.thumbnail_path
                ? `/api/images/thumbnails/${asset.thumbnail_path.split(/[/\\]/).pop()}`
                : `/api/images/originals/${asset.reference_image_path.split(/[/\\]/).pop()}`;
            return `
            <div class="asset-item" draggable="true" 
                 ondragstart="visualMode.handleDragStart(event, '${asset.id}', '${asset.slot}', '${thumbUrl}', '${asset.name}')">
                <img src="${thumbUrl}" alt="${asset.name}" loading="lazy">
            </div>`;
        }).join('');
    },

    // ─── DRAG & DROP (Asset → Mannequin) ─────────────────────────────────
    handleDragStart(event, id, slot, thumbUrl, name) {
        event.dataTransfer.setData('application/json', JSON.stringify({ id, slot, thumbUrl, name }));
    },

    allowDrop(event) {
        event.preventDefault();
        document.getElementById('visual-mannequin-container').classList.add('drag-over');
    },

    async handleDrop(event) {
        event.preventDefault();
        document.getElementById('visual-mannequin-container').classList.remove('drag-over');
        try {
            const dataStr = event.dataTransfer.getData('application/json');
            if (!dataStr) return;
            const assetData = JSON.parse(dataStr);
            this.equipAsset(assetData);
        } catch (err) {
            console.error('Drop error:', err);
        }
    },

    async equipAsset(assetData) {
        const { id, slot, thumbUrl, name } = assetData;

        // Determine the correct slot key — use currentSlotFilter if asset slot is a legacy/generic one
        const targetSlot = this.currentSlotFilter || slot;

        this.equippedSlots[targetSlot] = { id, thumbUrl, name, visible: true };

        // Add to layerOrder at the correct hierarchy position
        this._insertLayerAtHierarchyPosition(targetSlot);

        this.renderLayerStack();
        this.switchGroup(this.currentGroup); // refresh sub-slot badges

        // Fetch base64
        try {
            const res = await fetch(thumbUrl);
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                this.equippedSlots[targetSlot].base64 = base64;
                this._syncNodeAndRun(targetSlot, base64, name);
            };
            reader.readAsDataURL(blob);
        } catch (e) {
            console.error('Failed to convert dropped asset to base64', e);
        }
    },

    _syncNodeAndRun(slot, base64, desc) {
        if (!this.nodes.component) return;
        // Ensure property exists
        if (!this.nodes.component.properties[slot]) {
            this.nodes.component.properties[slot] = { enabled: false, description: '', referenceImage: null };
        }
        const compProp = this.nodes.component.properties[slot];
        compProp.enabled = true;
        compProp.referenceImage = base64;
        compProp.description = desc;
        this.nodes.component.setDirtyCanvas(true);
        this._lastNewSlot = slot; // Mark this as the newly added slot for incremental
        this.saveSession(); // Persist the dropped asset
        this.triggerRender();
    },

    /**
     * Insert a slot key into layerOrder at its correct hierarchy position.
     * If the slot is already in layerOrder, do nothing (preserving user drag-sort).
     */
    _insertLayerAtHierarchyPosition(slot) {
        if (this.layerOrder.includes(slot)) return;
        
        const targetRank = this.LAYER_HIERARCHY.indexOf(slot);
        if (targetRank === -1) {
            // Unknown slot — append at end
            this.layerOrder.push(slot);
            return;
        }

        // Find the correct insertion point based on hierarchy
        let insertAt = this.layerOrder.length; // default: end
        for (let i = 0; i < this.layerOrder.length; i++) {
            const existingRank = this.LAYER_HIERARCHY.indexOf(this.layerOrder[i]);
            if (existingRank > targetRank) {
                insertAt = i;
                break;
            }
        }
        this.layerOrder.splice(insertAt, 0, slot);
    },

    // ─── LAYER STACK (Right Sidebar) — with Drag-Sort ────────────────────
    renderLayerStack() {
        const stack = document.getElementById('layer-stack');

        // Build flat list of ALL possible slots, grouped
        const allSlots = [];
        for (const [groupKey, group] of Object.entries(this.SLOT_GROUPS)) {
            for (const s of group.slots) {
                allSlots.push({ ...s, group: groupKey });
            }
        }

        // Equipped layers (in user-defined order) go first
        const equippedHtml = this.layerOrder
            .filter(key => this.equippedSlots[key])
            .map((key, idx) => {
                const equipped = this.equippedSlots[key];
                const slotDef = allSlots.find(s => s.key === key) || { name: key, icon: '❓' };
                const eyeIcon = equipped.visible ? '👁️' : '🕶️';
                return `
                <div class="layer-item ${equipped.visible ? '' : 'hidden'}" 
                     draggable="true"
                     data-layer-idx="${idx}"
                     ondragstart="visualMode.onLayerDragStart(event, ${idx})"
                     ondragover="visualMode.onLayerDragOver(event, ${idx})"
                     ondrop="visualMode.onLayerDrop(event, ${idx})">
                    <span class="layer-drag-handle" title="Kéo để sắp xếp thứ tự">⣿</span>
                    <button class="layer-visibility" onclick="visualMode.toggleVisibility('${key}')">${eyeIcon}</button>
                    <div class="layer-thumb"><img src="${equipped.thumbUrl}"></div>
                    <div class="layer-info">
                        <div class="layer-slot">${slotDef.icon} ${slotDef.name}</div>
                        <div class="layer-name" title="${equipped.name}">${equipped.name}</div>
                    </div>
                    <button class="layer-remove" onclick="visualMode.removeEquip('${key}')">🗑️</button>
                </div>`;
            }).join('');

        // Empty slots (not equipped)
        const emptyHtml = allSlots
            .filter(s => !this.equippedSlots[s.key])
            .map(s => `
                <div class="layer-item empty">
                    <span class="layer-drag-handle" style="visibility:hidden;">⣿</span>
                    <div class="layer-thumb">${s.icon}</div>
                    <div class="layer-info">
                        <div class="layer-slot">${s.name}</div>
                        <div class="layer-name" style="color:var(--text-tertiary);">Chưa trang bị</div>
                    </div>
                </div>`).join('');

        stack.innerHTML = (equippedHtml || '') + 
            '<div class="layer-divider">── Chưa trang bị ──</div>' + 
            emptyHtml;
    },

    // ─── LAYER DRAG-SORT ─────────────────────────────────────────────────
    onLayerDragStart(event, idx) {
        this.dragSrcIndex = idx;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', idx);
        event.target.classList.add('dragging');
    },

    onLayerDragOver(event, idx) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        // Visual feedback
        const items = document.querySelectorAll('.layer-item:not(.empty)');
        items.forEach(el => el.classList.remove('drag-target'));
        if (items[idx]) items[idx].classList.add('drag-target');
    },

    onLayerDrop(event, targetIdx) {
        event.preventDefault();
        document.querySelectorAll('.layer-item').forEach(el => {
            el.classList.remove('dragging', 'drag-target');
        });

        if (this.dragSrcIndex === null || this.dragSrcIndex === targetIdx) return;

        // Reorder layerOrder array
        const moved = this.layerOrder.splice(this.dragSrcIndex, 1)[0];
        this.layerOrder.splice(targetIdx, 0, moved);
        this.dragSrcIndex = null;

        this.renderLayerStack();
        this.saveSession(); // Cache drag-sort
        // Layer order changed → invalidate incremental cache → force full re-render
        this.lastRenderedImage = null;
        this.lastRenderedSlots = [];
        this._forceFullRender = true;
        this.triggerRender();
    },

    // ─── LAYER VISIBILITY & REMOVAL ──────────────────────────────────────
    toggleVisibility(slot) {
        const equipped = this.equippedSlots[slot];
        if (!equipped) return;
        equipped.visible = !equipped.visible;
        this.renderLayerStack();
        this.saveSession();

        if (this.nodes.component && this.nodes.component.properties[slot]) {
            this.nodes.component.properties[slot].enabled = equipped.visible;
            this.triggerRender();
        }
    },

    removeEquip(slot) {
        this.equippedSlots[slot] = null;
        this.layerOrder = this.layerOrder.filter(k => k !== slot);
        this.renderLayerStack();
        this.switchGroup(this.currentGroup); // refresh sub-slot badges

        // Invalidate incremental cache — composition changed
        this.lastRenderedImage = null;
        this.lastRenderedSlots = [];

        if (this.nodes.component && this.nodes.component.properties[slot]) {
            this.nodes.component.properties[slot].enabled = false;
            this.nodes.component.properties[slot].referenceImage = null;
            this.saveSession();
            this._forceFullRender = true;
            this.triggerRender();
        }
    },

    resetOutfit() {
        for (const key of Object.keys(this.equippedSlots)) {
            this.equippedSlots[key] = null;
            if (this.nodes.component && this.nodes.component.properties[key]) {
                this.nodes.component.properties[key].enabled = false;
                this.nodes.component.properties[key].referenceImage = null;
            }
        }
        this.layerOrder = [];
        this.lastRenderedImage = null;
        this.lastRenderedSlots = [];
        document.getElementById('visual-preview-img').src = this.currentBaseModelStr || this.defaultMannequinPath;
        this.renderLayerStack();
        this.switchGroup(this.currentGroup);
        this.saveSession();
    },

    // ─── RENDER (Call API) ───────────────────────────────────────────────
    triggerRender() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
            // Check if any slot is actually enabled
            let hasEnabled = false;
            const allSlotKeys = Object.keys(this.equippedSlots);
            const enabledSlots = [];
            for (const s of allSlotKeys) {
                if (this.nodes.component.properties[s] && this.nodes.component.properties[s].enabled) {
                    hasEnabled = true;
                    enabledSlots.push(s);
                }
            }

            if (!hasEnabled) {
                document.getElementById('visual-preview-img').src = this.currentBaseModelStr || this.defaultMannequinPath;
                this.lastRenderedImage = null;
                this.lastRenderedSlots = [];
                return;
            }

            // ─── DETECT INCREMENTAL vs FULL RENDER ───────────────────
            let incrementalSlot = null;
            let useIncrementalMode = false;

            if (this._forceFullRender) {
                // User explicitly requested full re-render
                this._forceFullRender = false;
                console.log('[VisualMode] Force full re-render requested');
            } else if (this._lastNewSlot && this.lastRenderedImage && this.lastRenderedSlots.length > 0) {
                // Check if the only difference is the newly added slot
                const previousSlots = new Set(this.lastRenderedSlots);
                const addedSlots = enabledSlots.filter(s => !previousSlots.has(s));
                
                if (addedSlots.length === 1 && addedSlots[0] === this._lastNewSlot) {
                    incrementalSlot = this._lastNewSlot;
                    useIncrementalMode = true;
                    console.log(`[VisualMode] Incremental mode: adding "${incrementalSlot}" to existing render`);
                }
            }
            this._lastNewSlot = null; // Reset after checking

            // ─── CACHE KEY (includes model + layer order) ────────────
            const currentModel = this.nodes.component.properties.model || 'pro';
            let cacheKey = `${currentModel}_${this.currentBaseModelStr ? 'custom_base' : 'default_mannequin'}`;

            // Use layerOrder for cache key (order matters!)
            this.layerOrder.forEach(s => {
                const prop = this.nodes.component.properties[s];
                if (prop && prop.enabled && prop.referenceImage) {
                    const refSnip = prop.referenceImage.length + '_' + prop.referenceImage.substring(0, 20);
                    cacheKey += `|${s}:${refSnip}`;
                }
            });

            if (this.previewCache.has(cacheKey)) {
                console.log('[VisualMode] Cache HIT (0ms)!');
                document.getElementById('visual-preview-img').src = this.previewCache.get(cacheKey);
                const overlay = document.getElementById('visual-loading-overlay');
                if (overlay) {
                    overlay.style.display = 'flex';
                    setTimeout(() => { overlay.style.display = 'none'; }, 200);
                }
                return;
            }

            // ─── API CALL ────────────────────────────────────────────
            const overlay = document.getElementById('visual-loading-overlay');
            const spinner = document.getElementById('visual-spinner');
            const loadingText = document.getElementById('visual-loading-text');
            const retryBtn = document.getElementById('btn-retry-visual');
            
            if (overlay) {
                overlay.style.display = 'flex';
                if (spinner) spinner.style.display = 'block';
                if (retryBtn) retryBtn.style.display = 'none';
                if (loadingText) {
                    loadingText.textContent = useIncrementalMode 
                        ? `Đang thêm ${incrementalSlot}... (chế độ tăng dần)`
                        : 'Đang thay đồ... (render toàn bộ)';
                }
            }

            this.currentAbortController = new AbortController();

            try {
                const inputNode = this.nodes.input;
                const compNode = this.nodes.component;
                const outputNode = this.nodes.output;

                // Pass layerOrder as part of component properties so backend knows the order
                compNode.properties._layerOrder = this.layerOrder.filter(k => 
                    compNode.properties[k] && compNode.properties[k].enabled
                );

                let requestBody;

                if (useIncrementalMode && incrementalSlot) {
                    // ── INCREMENTAL MODE: Only send the new slot ──────
                    // Create a minimal component config with ONLY the incremental slot
                    const incrementalProps = {
                        model: compNode.properties.model,
                        preserveFace: compNode.properties.preserveFace,
                        ffMode: compNode.properties.ffMode,
                        isOnePiece: false,
                        _incrementalMode: true,
                        _incrementalSlot: incrementalSlot,
                        _layerOrder: [incrementalSlot],
                    };
                    // Copy only the incremental slot's config
                    incrementalProps[incrementalSlot] = { ...compNode.properties[incrementalSlot] };

                    const workflow = {
                        nodes: [
                            { id: 'input_1', type: 'image_input', properties: inputNode.properties },
                            { id: 'comp_1', type: 'component_selector', properties: incrementalProps },
                            { id: 'output_1', type: 'output', properties: outputNode.properties },
                        ],
                        connections: [
                            { sourceId: 'input_1', targetId: 'comp_1', sourcePort: 0, targetPort: 0 },
                            { sourceId: 'comp_1', targetId: 'output_1', sourcePort: 0, targetPort: 0 },
                        ],
                    };

                    // The base image is the LAST RENDERED result, not the original mannequin
                    const imageData = {};
                    imageData['input_1'] = { 
                        data: this.lastRenderedImage, 
                        mimeType: 'image/png' 
                    };

                    let promptOverrides = {};
                    try {
                        const saved = localStorage.getItem('nanobana_prompt_overrides');
                        if (saved) promptOverrides = JSON.parse(saved);
                    } catch(e) {}

                    requestBody = { workflow, imageData, promptOverrides };
                } else {
                    // ── FULL RENDER MODE: Send all slots ──────────────
                    const workflow = {
                        nodes: [
                            { id: 'input_1', type: 'image_input', properties: inputNode.properties },
                            { id: 'comp_1', type: 'component_selector', properties: compNode.properties },
                            { id: 'output_1', type: 'output', properties: outputNode.properties },
                        ],
                        connections: [
                            { sourceId: 'input_1', targetId: 'comp_1', sourcePort: 0, targetPort: 0 },
                            { sourceId: 'comp_1', targetId: 'output_1', sourcePort: 0, targetPort: 0 },
                        ],
                    };

                    const imageData = {};
                    if (inputNode.properties.imageData) {
                        imageData['input_1'] = { data: inputNode.properties.imageData, mimeType: 'image/png' };
                    }

                    let promptOverrides = {};
                    try {
                        const saved = localStorage.getItem('nanobana_prompt_overrides');
                        if (saved) promptOverrides = JSON.parse(saved);
                    } catch(e) {}

                    requestBody = { workflow, imageData, promptOverrides };
                }

                this.currentAbortController = new AbortController();

                const response = await fetch('/api/workflow/execute', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': localStorage.getItem('nanobana_api_key') || '',
                    },
                    body: JSON.stringify(requestBody),
                    signal: this.currentAbortController.signal
                });

                const result = await response.json();

                if (result.success && result.image) {
                    this.previewCache.set(cacheKey, result.image.path);
                    document.getElementById('visual-preview-img').src = result.image.path;
                    
                    // ── Store result for future incremental renders ──
                    try {
                        const imgRes = await fetch(result.image.path);
                        const imgBlob = await imgRes.blob();
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            this.lastRenderedImage = reader.result.split(',')[1];
                            this.lastRenderedSlots = [...enabledSlots];
                        };
                        reader.readAsDataURL(imgBlob);
                    } catch (e) {
                        console.warn('[VisualMode] Could not cache rendered image for incremental mode', e);
                    }

                    // v3.1: Track incremental edit count for pixel degradation warning
                    if (useIncrementalMode) {
                        this.incrementalEditCount++;
                        if (this.incrementalEditCount === 3) {
                            setTimeout(() => {
                                app.showToast('⚠️ Đã thêm 3+ lớp đồ. Nhấn "🔄 Phục hồi pixel" nếu ảnh bị vỡ hoặc mờ.', 'warning');
                            }, 1500);
                        }
                    } else {
                        this.incrementalEditCount = 0; // Reset on full render
                    }

                    app.showToast(useIncrementalMode 
                        ? `Đã thêm ${incrementalSlot} thành công!` 
                        : 'Trang phục đã được áp dụng!', 'success');
                    if (overlay) overlay.style.display = 'none';
                } else {
                    throw new Error(result.error || result.text || 'Không thể tạo ảnh');
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    app.showToast('Đã dừng thao tác vẽ!', 'warning');
                    if (overlay) overlay.style.display = 'none';
                    return;
                }
                console.error('[VisualMode] Render error:', err);
                
                // Show Error Overlay instead of generic toast
                if (overlay && loadingText && retryBtn && spinner) {
                    spinner.style.display = 'none';
                    loadingText.textContent = '❌ Lỗi: ' + err.message;
                    retryBtn.style.display = 'block';
                } else {
                    app.showToast('Lỗi render: ' + err.message, 'error');
                    if (overlay) overlay.style.display = 'none';
                }
            } finally {
                this.currentAbortController = null;
            }
        }, 800);
    },

    /**
     * Force a full re-render of ALL equipped slots (ignoring incremental cache)
     */
    forceFullRender() {
        this._forceFullRender = true;
        this._lastNewSlot = null;
        this.lastRenderedImage = null;
        this.lastRenderedSlots = [];
        this.triggerRender();
    },

    /**
     * Retry the last render attempt (used by the retry button in the overlay)
     */
    retryRender() {
        this.triggerRender();
    },


    // ─── CANCEL GENERATION ───────────────────────────────────────────────
    cancelGeneration() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            app.showToast('Đang hủy thay đồ...', 'info');
            const overlay = document.getElementById('visual-loading-overlay');
            if (overlay) overlay.style.display = 'none';
        } else {
            app.showToast('Không có tiến trình nào đang chạy.', 'info');
        }
    },

    // ─── DOWNLOAD (with Upscale) ─────────────────────────────────────────
    async downloadCurrent() {
        const imgUrl = document.getElementById('visual-preview-img').src;
        if (!imgUrl || imgUrl.endsWith('mannequin_default.png')) {
            app.showToast('Vui lòng mặc đồ trước khi lưu', 'warning');
            return;
        }

        const overlay = document.getElementById('visual-loading-overlay');
        const overlayText = overlay ? overlay.querySelector('div:last-child') : null;

        try {
            app.showToast('Đang gọi AI Vertex phóng to ảnh lên 2K...', 'info');
            if (overlay && overlayText) {
                overlayText.textContent = 'Đang Phóng To Siêu Nét 2K...';
                overlay.style.display = 'flex';
            }

            const res = await fetch(imgUrl);
            const blob = await res.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
            });

            const upRes = await fetch('/api/workflow/upscale', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': localStorage.getItem('nanobana_api_key') || ''
                },
                body: JSON.stringify({ imageBase64: base64 })
            });
            const data = await upRes.json();

            if (!data.success) throw new Error(data.error || 'Server không phản hồi ảnh 2K');

            const a = document.createElement('a');
            a.href = data.image.path;
            a.download = 'freefire_outfit_2k_' + Date.now() + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            app.showToast('Đã lưu cực nét (2K) thành công!', 'success');

        } catch (e) {
            console.error('[Upscale]', e);
            app.showToast('Lỗi Upscale: ' + e.message + '. Trả về ảnh 1K.', 'warning');
            const a = document.createElement('a');
            a.href = imgUrl;
            a.download = 'freefire_outfit_1k_' + Date.now() + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } finally {
            if (overlay && overlayText) {
                overlay.style.display = 'none';
                overlayText.textContent = 'Đang thay đồ...';
            }
        }
    },

    // ─── Phase 2: MULTI-POSE DOWNLOAD ─────────────────────────────────────────
    async downloadMultiPose() {
        const imgUrl = document.getElementById('visual-preview-img').src;
        if (!imgUrl || imgUrl.endsWith('mannequin_default.png')) {
            app.showToast('Vui lòng mặc đồ trước khi xuất Multi-pose', 'warning');
            return;
        }

        const overlay = document.getElementById('visual-loading-overlay');
        const overlayText = overlay ? overlay.querySelector('div:last-child') : null;

        try {
            app.showToast('Đang gọi AI render 5 góc nhìn...', 'info');
            if (overlay && overlayText) {
                overlayText.textContent = 'Đang ghép 5 poses siêu tốc...';
                overlay.style.display = 'flex';
            }

            if (!this.nodes.component) return;

            const workflow = {
                nodes: [
                    { id: 'input_1', type: 'image_input', properties: { imageData: '' } },
                    { id: 'comp_1', type: 'component_selector', properties: { ...this.nodes.component.properties, _layerOrder: this.layerOrder } },
                    { id: 'output_1', type: 'output', properties: { multiView: true } }
                ],
                connections: [
                    { sourceId: 'input_1', targetId: 'comp_1', sourcePort: 0, targetPort: 0 },
                    { sourceId: 'comp_1', targetId: 'output_1', sourcePort: 0, targetPort: 0 },
                ],
            };

            const imageData = {};
            if (this.nodes.input && this.nodes.input.properties.imageData) {
                imageData['input_1'] = { data: this.nodes.input.properties.imageData, mimeType: 'image/png' };
            }

            // Load Flow Editor prompt overrides to enforce style
            let promptOverrides = {};
            try {
                const saved = localStorage.getItem('nanobana_prompt_overrides');
                if (saved) promptOverrides = JSON.parse(saved);
            } catch(e) {}

            this.currentAbortController = new AbortController();

            const response = await fetch('/api/workflow/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': localStorage.getItem('nanobana_api_key') || '',
                },
                body: JSON.stringify({ workflow, imageData, promptOverrides }),
                signal: this.currentAbortController.signal
            });

            const result = await response.json();

            if (result.success && result.image) {
                const a = document.createElement('a');
                a.href = result.image.path; // Image path saved by the backend
                a.download = 'multipose_5120x1024_' + Date.now() + '.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                app.showToast('Đã lưu cực nét (Multi-Pose) thành công!', 'success');
            } else {
                throw new Error(result.error || result.text || 'Lỗi hệ thống');
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                app.showToast('Đã dừng xuất góc', 'warning');
            } else {
                console.error('[Multi-Pose]', err);
                app.showToast('Lỗi Multi-Pose: ' + err.message, 'error');
            }
        } finally {
            this.currentAbortController = null;
            if (overlay && overlayText) {
                overlay.style.display = 'none';
                overlayText.textContent = 'Đang thay đồ...';
            }
        }
    },

    // ─── Phase 3: ELEMENT EXTRACTION ──────────────────────────────────────────
    async extractElements() {
        const imgUrl = document.getElementById('visual-preview-img').src;
        if (!imgUrl || imgUrl.endsWith('mannequin_default.png')) {
            app.showToast('Vui lòng mặc đồ trước khi tách element', 'warning');
            return;
        }

        // Gather equipped slot keys
        const equippedSlots = Object.entries(this.equippedSlots)
            .filter(([_, v]) => v && v.visible !== false)
            .map(([k]) => k);

        if (equippedSlots.length === 0) {
            app.showToast('Chưa có element nào để tách!', 'warning');
            return;
        }

        const overlay = document.getElementById('visual-loading-overlay');
        const overlayText = overlay ? overlay.querySelector('div:last-child') : null;

        try {
            app.showToast(`Đang tách ${equippedSlots.length} element(s)...`, 'info');
            if (overlay && overlayText) {
                overlayText.textContent = `Đang tách ${equippedSlots.length} element...`;
                overlay.style.display = 'flex';
            }

            // Get the current preview image as base64
            const res = await fetch(imgUrl);
            const blob = await res.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
            });

            const response = await fetch('/api/workflow/extract-elements', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': localStorage.getItem('nanobana_api_key') || '',
                },
                body: JSON.stringify({
                    imageBase64: base64,
                    equippedSlots,
                    model: document.getElementById('visual-model-select')?.value || 'pro',
                }),
            });

            const result = await response.json();

            if (result.success && result.elements && result.elements.length > 0) {
                this.showExtractionResults(result.elements);
                app.showToast(`Tách thành công ${result.totalExtracted}/${result.totalRequested} element!`, 'success');
            } else {
                throw new Error(result.error || 'Không tách được element nào');
            }
        } catch (err) {
            console.error('[Extract]', err);
            app.showToast('Lỗi tách element: ' + err.message, 'error');
        } finally {
            if (overlay && overlayText) {
                overlay.style.display = 'none';
                overlayText.textContent = 'Đang thay đồ...';
            }
        }
    },

    showExtractionResults(elements) {
        // Remove old modal if exists
        const oldModal = document.getElementById('extract-modal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.id = 'extract-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: var(--bg-secondary, #1a1a2e); border-radius: 16px;
            padding: 24px; max-width: 800px; width: 90%; max-height: 80vh;
            overflow-y: auto; border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 24px 80px rgba(0,0,0,0.5);
        `;

        // Header
        content.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2 style="margin:0; font-size:20px; color:white;">🧩 Extracted Elements (${elements.length})</h2>
                <div style="display:flex; gap:8px;">
                    <button id="extract-download-all" style="padding:8px 16px; border-radius:8px; border:none; background:linear-gradient(135deg,#36D1DC,#5B86E5); color:white; cursor:pointer; font-weight:600; font-size:13px;">
                        📦 Tải Tất Cả
                    </button>
                    <button id="extract-close" style="padding:8px 16px; border-radius:8px; border:1px solid rgba(255,255,255,0.2); background:transparent; color:white; cursor:pointer; font-size:13px;">
                        ✕ Đóng
                    </button>
                </div>
            </div>
            <div id="extract-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:16px;"></div>
        `;

        const grid = content.querySelector('#extract-grid');

        for (const el of elements) {
            const card = document.createElement('div');
            card.style.cssText = `
                background: rgba(255,255,255,0.05); border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.1); overflow: hidden;
                transition: transform 0.2s, box-shadow 0.2s; cursor: pointer;
            `;
            card.onmouseenter = () => { card.style.transform = 'translateY(-4px)'; card.style.boxShadow = '0 8px 24px rgba(54,209,220,0.2)'; };
            card.onmouseleave = () => { card.style.transform = ''; card.style.boxShadow = ''; };

            card.innerHTML = `
                <div style="aspect-ratio:1; background:repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/20px 20px; display:flex; align-items:center; justify-content:center;">
                    <img src="${el.imagePath}" alt="${el.name}" style="max-width:100%; max-height:100%; object-fit:contain;" />
                </div>
                <div style="padding:10px;">
                    <div style="font-weight:600; color:white; font-size:13px;">${el.icon} ${el.name}</div>
                    <div style="font-size:11px; color:rgba(255,255,255,0.5); margin-top:2px;">${el.slot} — 1024×1024</div>
                    <button class="extract-dl-btn" data-path="${el.imagePath}" data-slot="${el.slot}" style="margin-top:8px; width:100%; padding:6px; border-radius:6px; border:none; background:rgba(54,209,220,0.15); color:#36D1DC; cursor:pointer; font-size:12px; font-weight:600;">
                        💾 Tải PNG
                    </button>
                </div>
            `;
            grid.appendChild(card);
        }

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Close handler
        modal.querySelector('#extract-close').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        // Individual download
        modal.querySelectorAll('.extract-dl-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const a = document.createElement('a');
                a.href = btn.dataset.path;
                a.download = `element_${btn.dataset.slot}_${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            };
        });

        // Download all
        modal.querySelector('#extract-download-all').onclick = async () => {
            for (const el of elements) {
                const a = document.createElement('a');
                a.href = el.imagePath;
                a.download = `element_${el.slot}_${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                await new Promise(r => setTimeout(r, 300)); // Small delay between downloads
            }
            app.showToast('Đã tải tất cả element!', 'success');
        };
    },

    // ─── CUSTOM ASSET UPLOAD ─────────────────────────────────────────────
    async uploadCustomAssetFromUrl() {
        const slotKey = this.currentSlotFilter || 'top_inner';
        const url = prompt(`Nhập đường dẫn URL cho ảnh ${slotKey}:`);
        if (!url) return;

        app.showToast('Đang tải và chuyển đổi asset từ URL...', 'info');
        const overlay = document.getElementById('visual-loading-overlay');
        if (overlay) overlay.style.display = 'flex';

        try {
            const fetchRes = await API.fetchImageUrl(url);
            if (!fetchRes.success || !fetchRes.base64) throw new Error('Không thể tải ảnh từ URL');

            const byteString = atob(fetchRes.base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: 'image/png' });
            const file = new File([blob], 'url_asset.png', { type: 'image/png' });

            const formData = new FormData();
            formData.append('image', file);
            formData.append('slot', slotKey);
            formData.append('name', 'URL Asset (' + slotKey + ')');

            const res = await fetch('/api/assets/convert', {
                method: 'POST',
                headers: { 'X-API-Key': localStorage.getItem('nanobana_api_key') || '' },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                app.showToast('Chuyển đổi thành công!', 'success');
                this.fetchAssets(slotKey);
            } else {
                app.showToast(data.error || 'Lỗi chuyển đổi', 'error');
            }
        } catch (err) {
            console.error('URL convert error:', err);
            app.showToast(err.message || 'Lỗi xử lý URL', 'error');
        } finally {
            if (overlay) overlay.style.display = 'none';
        }
    },

    openConvertModal() {
        const slotKey = this.currentSlotFilter || 'top_inner';
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            app.showToast('Đang chuyển đổi asset...', 'info');
            const overlay = document.getElementById('visual-loading-overlay');
            if (overlay) overlay.style.display = 'flex';

            const formData = new FormData();
            formData.append('image', file);
            formData.append('slot', slotKey);
            formData.append('name', file.name.split('.')[0] + ' (Converted)');

            try {
                const res = await fetch('/api/assets/convert', {
                    method: 'POST',
                    headers: { 'X-API-Key': localStorage.getItem('nanobana_api_key') || '' },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    app.showToast('Chuyển đổi thành công!', 'success');
                    this.fetchAssets(slotKey);
                } else {
                    app.showToast(data.error || 'Lỗi chuyển đổi', 'error');
                }
            } catch (err) {
                app.showToast('Lỗi mạng', 'error');
            } finally {
                if (overlay) overlay.style.display = 'none';
            }
        };
        input.click();
    },

    // ─── PIXEL RECOVERY (v3.1) ────────────────────────────────────────────
    async pixelRecover() {
        const imgEl = document.getElementById('visual-preview-img');
        const imgUrl = imgEl ? imgEl.src : null;
        if (!imgUrl || imgUrl.endsWith('mannequin_default.png') || imgUrl.endsWith('.html')) {
            app.showToast('Chưa có ảnh để phục hồi pixel!', 'warning');
            return;
        }

        const overlay = document.getElementById('visual-loading-overlay');
        const loadingText = document.getElementById('visual-loading-text');
        if (overlay) {
            overlay.style.display = 'flex';
            if (loadingText) loadingText.textContent = '🔄 Đang phục hồi pixel...';
        }

        try {
            // Get current image as base64
            const res = await fetch(imgUrl);
            const blob = await res.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
            });

            const model = this.nodes.component?.properties?.model || 'pro';

            const response = await fetch('/api/workflow/pixel-recover', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': localStorage.getItem('nanobana_api_key') || '',
                },
                body: JSON.stringify({ imageBase64: base64, model }),
            });

            const result = await response.json();
            if (result.success && result.image) {
                imgEl.src = result.image.path;
                // Update the incremental base to the recovered image
                this.lastRenderedImage = result.image.imageBase64;
                this.incrementalEditCount = 0; // Reset counter after recovery
                this.previewCache.clear(); // Invalidate cache
                app.showToast('✅ Pixel đã được phục hồi!', 'success');
            } else {
                throw new Error(result.error || 'Không phục hồi được');
            }
        } catch (err) {
            console.error('[PixelRecover]', err);
            app.showToast('Lỗi phục hồi pixel: ' + err.message, 'error');
        } finally {
            if (overlay) overlay.style.display = 'none';
            if (loadingText) loadingText.textContent = 'Đang thay đồ...';
        }
    },

    // ─── HEAD EDITOR (v3.1) ───────────────────────────────────────────────
    headEditor: {
        _croppedHeadBase64: null,   // base64 of the cropped head
        _originalBodyBase64: null,  // base64 of full body model (before head edit)
        _editedHeadBase64: null,    // base64 of the AI-edited head
        refImageBase64: null,       // optional reference image for tattoo/makeup

        /**
         * Crop the top 35% of the current preview image as the head region
         */
        async cropHead() {
            // Get current model (prefer the lastRenderedImage otherwise base model)
            const imgEl = document.getElementById('visual-preview-img');
            const imgSrc = imgEl?.src;
            if (!imgSrc || imgSrc.endsWith('mannequin_default.png')) {
                app.showToast('Vui lòng tải ảnh nhân vật trước!', 'warning');
                return;
            }

            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const cropHeight = Math.round(img.height * 0.38); // top 38% = head region
                    canvas.width = img.width;
                    canvas.height = cropHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, img.width, cropHeight, 0, 0, img.width, cropHeight);
                    const dataUrl = canvas.toDataURL('image/png');
                    this._croppedHeadBase64 = dataUrl.split(',')[1];

                    // Also save full body base64 for compositing later
                    const bodyCanvas = document.createElement('canvas');
                    bodyCanvas.width = img.width;
                    bodyCanvas.height = img.height;
                    const bodyCtx = bodyCanvas.getContext('2d');
                    bodyCtx.drawImage(img, 0, 0);
                    this._originalBodyBase64 = bodyCanvas.toDataURL('image/png').split(',')[1];

                    // Update head preview
                    const headPreview = document.getElementById('head-editor-preview');
                    if (headPreview) {
                        headPreview.src = dataUrl;
                        headPreview.style.display = 'block';
                    }
                    app.showToast('✅ Đã cắt vùng đầu!', 'success');
                    resolve(dataUrl);
                };
                img.onerror = reject;
                img.src = imgSrc;
            });
        },

        /**
         * Upload a reference image for head editing (tattoo pattern, etc)
         */
        uploadReference() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.refImageBase64 = ev.target.result.split(',')[1];
                    const refThumb = document.getElementById('head-ref-thumb');
                    if (refThumb) {
                        refThumb.src = ev.target.result;
                        refThumb.style.display = 'block';
                    }
                    app.showToast('Ảnh tham chiếu đã tải!', 'success');
                };
                reader.readAsDataURL(file);
            };
            input.click();
        },

        /**
         * Call API to edit the head
         */
        async editHead() {
            if (!this._croppedHeadBase64) {
                app.showToast('Hãy cắt vùng đầu trước (Bước 1)!', 'warning');
                return;
            }

            const descInput = document.getElementById('head-edit-description');
            const editType = document.getElementById('head-edit-type')?.value || 'face_tattoo';
            const description = descInput?.value?.trim();

            if (!description) {
                app.showToast('Hãy nhập mô tả chỉnh sửa!', 'warning');
                return;
            }

            const btn = document.getElementById('btn-head-edit');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang AI chỉnh...'; }

            try {
                const formData = new FormData();
                formData.append('imageBase64', this._croppedHeadBase64);
                formData.append('editDescription', description);
                formData.append('editType', editType);
                formData.append('model', visualMode.nodes.component?.properties?.model || 'pro');

                if (this.refImageBase64) {
                    // Convert base64 to blob and append as file
                    const byteString = atob(this.refImageBase64);
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                    const blob = new Blob([ab], { type: 'image/png' });
                    formData.append('referenceImage', blob, 'reference.png');
                }

                const res = await fetch('/api/workflow/head-edit', {
                    method: 'POST',
                    headers: { 'X-API-Key': localStorage.getItem('nanobana_api_key') || '' },
                    body: formData,
                });

                const result = await res.json();
                if (result.success && result.image) {
                    this._editedHeadBase64 = result.image.imageBase64;
                    const editedPreview = document.getElementById('head-edited-preview');
                    if (editedPreview) {
                        editedPreview.src = result.image.path;
                        editedPreview.style.display = 'block';
                    }
                    // Enable the composite button
                    const compositeBtn = document.getElementById('btn-head-composite');
                    if (compositeBtn) compositeBtn.disabled = false;
                    app.showToast('✅ Mặt đã được chỉnh! Nhấn Bước 3 để ghép vào model.', 'success');
                } else {
                    throw new Error(result.error || 'Lỗi AI chỉnh mặt');
                }
            } catch (err) {
                console.error('[HeadEdit]', err);
                app.showToast('Lỗi chỉnh mặt: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '🎨 Bước 2: AI Chỉnh Mặt'; }
            }
        },

        /**
         * Composite the edited head back onto the original body
         */
        async compositeHead() {
            if (!this._editedHeadBase64) {
                app.showToast('Hãy chỉnh mặt trước (Bước 2)!', 'warning');
                return;
            }
            if (!this._originalBodyBase64) {
                app.showToast('Không tìm thấy ảnh body gốc!', 'warning');
                return;
            }

            const btn = document.getElementById('btn-head-composite');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang ghép...'; }

            try {
                const model = visualMode.nodes.component?.properties?.model || 'pro';
                const res = await fetch('/api/workflow/head-composite', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': localStorage.getItem('nanobana_api_key') || '',
                    },
                    body: JSON.stringify({
                        bodyBase64: this._originalBodyBase64,
                        headBase64: this._editedHeadBase64,
                        model,
                    }),
                });

                const result = await res.json();
                if (result.success && result.image) {
                    // Update the main preview and base model
                    const previewImg = document.getElementById('visual-preview-img');
                    if (previewImg) previewImg.src = result.image.path;

                    // Update lastRenderedImage for future incremental renders
                    visualMode.lastRenderedImage = result.image.imageBase64;
                    visualMode.lastRenderedSlots = [...Object.keys(visualMode.equippedSlots).filter(k => visualMode.equippedSlots[k])];
                    visualMode.previewCache.clear();
                    visualMode.incrementalEditCount = 0;

                    app.showToast('✅ Ghép đầu thành công! Model đã được cập nhật.', 'success');

                    // Show result preview
                    const resultPreview = document.getElementById('head-result-preview');
                    if (resultPreview) {
                        resultPreview.src = result.image.path;
                        resultPreview.style.display = 'block';
                    }
                } else {
                    throw new Error(result.error || 'Lỗi ghép đầu');
                }
            } catch (err) {
                console.error('[HeadComposite]', err);
                app.showToast('Lỗi ghép đầu: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '🧩 Bước 3: Ghép vào Model'; }
            }
        },

        /**
         * Show the Head Editor panel
         */
        show() {
            // Switch the group display to head editor
            const existing = document.getElementById('head-editor-panel');
            if (existing) { existing.style.display = existing.style.display === 'none' ? 'block' : 'none'; return; }

            const panel = document.createElement('div');
            panel.id = 'head-editor-panel';
            panel.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                z-index: 9999; width: 680px; max-width: 95vw; max-height: 90vh; overflow-y: auto;
                background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%);
                border: 1px solid rgba(255,100,200,0.3); border-radius: 20px;
                box-shadow: 0 32px 80px rgba(0,0,0,0.7); padding: 24px;
                font-family: 'Inter', -apple-system, sans-serif; color: white;
            `;

            panel.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 style="margin:0; font-size:20px; background:linear-gradient(135deg,#FF6EC7,#B06EFF); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">
                        🎭 Head Editor — Chỉnh Sửa Mặt & Hình Xăm
                    </h2>
                    <button onclick="document.getElementById('head-editor-panel').remove()" style="background:transparent; border:1px solid rgba(255,255,255,0.2); color:white; border-radius:8px; padding:6px 12px; cursor:pointer;">✕ Đóng</button>
                </div>

                <!-- Step 1: Crop Head -->
                <div style="background:rgba(255,110,199,0.08); border:1px solid rgba(255,110,199,0.2); border-radius:14px; padding:16px; margin-bottom:16px;">
                    <h3 style="margin:0 0 12px 0; font-size:14px; color:#FF6EC7;">🔪 Bước 1: Cắt Vùng Đầu</h3>
                    <p style="margin:0 0 12px 0; font-size:12px; color:rgba(255,255,255,0.6);">Cắt top 38% ảnh nhân vật hiện tại để lấy vùng đầu/mặt.</p>
                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <button id="btn-crop-head" onclick="visualMode.headEditor.cropHead()" style="padding:10px 18px; background:linear-gradient(135deg,#FF6EC7,#B06EFF); border:none; border-radius:10px; color:white; font-weight:700; cursor:pointer; font-size:13px; white-space:nowrap;">✂️ Cắt Đầu</button>
                        <div style="flex:1; text-align:center;">
                            <img id="head-editor-preview" src="" style="display:none; max-width:120px; border-radius:8px; border:2px solid rgba(255,110,199,0.4);" alt="Head crop preview">
                            <div id="head-editor-placeholder" style="font-size:11px; color:rgba(255,255,255,0.4);">Preview đầu sẽ hiện ở đây</div>
                        </div>
                    </div>
                </div>

                <!-- Step 2: Edit Head -->
                <div style="background:rgba(176,110,255,0.08); border:1px solid rgba(176,110,255,0.2); border-radius:14px; padding:16px; margin-bottom:16px;">
                    <h3 style="margin:0 0 12px 0; font-size:14px; color:#B06EFF;">🎨 Bước 2: AI Chỉnh Sửa Mặt</h3>
                    
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                        <div>
                            <label style="font-size:11px; color:rgba(255,255,255,0.5); display:block; margin-bottom:4px;">Loại chỉnh sửa:</label>
                            <select id="head-edit-type" style="width:100%; padding:8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:white; font-size:12px;">
                                <option value="face_tattoo">🔥 Hình xăm mặt</option>
                                <option value="face_makeup">💄 Trang điểm</option>
                                <option value="face_scar">⚡ Sẹo / Dấu vết</option>
                                <option value="eyes">👁️ Mắt (màu, ánh sáng)</option>
                                <option value="hair_color">🎨 Màu tóc</option>
                                <option value="face_shape">🎭 Khuôn mặt (nhẹ)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:11px; color:rgba(255,255,255,0.5); display:block; margin-bottom:4px;">Ảnh tham chiếu (tùy chọn):</label>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <button onclick="visualMode.headEditor.uploadReference()" style="padding:8px 12px; background:rgba(255,255,255,0.08); border:1px dashed rgba(255,255,255,0.3); border-radius:8px; color:white; cursor:pointer; font-size:11px;">📁 Upload</button>
                                <img id="head-ref-thumb" src="" style="display:none; width:40px; height:40px; border-radius:6px; object-fit:cover; border:1px solid rgba(176,110,255,0.4);" alt="ref">
                            </div>
                        </div>
                    </div>

                    <label style="font-size:11px; color:rgba(255,255,255,0.5); display:block; margin-bottom:4px;">Mô tả chỉnh sửa:</label>
                    <textarea id="head-edit-description" placeholder="Ví dụ: Thêm hình xăm rồng đỏ bên má trái, phong cách tribal FF..." style="width:100%; min-height:70px; padding:10px; box-sizing:border-box; background:rgba(255,255,255,0.08); border:1px solid rgba(176,110,255,0.3); border-radius:8px; color:white; font-size:12px; resize:vertical; outline:none;"></textarea>

                    <div style="display:flex; gap:12px; margin-top:12px; align-items:flex-start;">
                        <button id="btn-head-edit" onclick="visualMode.headEditor.editHead()" style="padding:10px 20px; background:linear-gradient(135deg,#B06EFF,#5B86E5); border:none; border-radius:10px; color:white; font-weight:700; cursor:pointer; font-size:13px; white-space:nowrap;">🎨 Bước 2: AI Chỉnh Mặt</button>
                        <div style="flex:1; text-align:center;">
                            <img id="head-edited-preview" src="" style="display:none; max-width:120px; border-radius:8px; border:2px solid rgba(176,110,255,0.4);" alt="edited head">
                        </div>
                    </div>
                </div>

                <!-- Step 3: Composite -->
                <div style="background:rgba(54,209,220,0.08); border:1px solid rgba(54,209,220,0.2); border-radius:14px; padding:16px; margin-bottom:16px;">
                    <h3 style="margin:0 0 12px 0; font-size:14px; color:#36D1DC;">🧩 Bước 3: Ghép Đầu Vào Model</h3>
                    <p style="margin:0 0 12px 0; font-size:12px; color:rgba(255,255,255,0.6);">AI sẽ ghép mặt đã chỉnh vào body gốc, tạo model hoàn chỉnh.</p>
                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <button id="btn-head-composite" onclick="visualMode.headEditor.compositeHead()" disabled style="padding:10px 20px; background:linear-gradient(135deg,#36D1DC,#5B86E5); border:none; border-radius:10px; color:white; font-weight:700; cursor:pointer; font-size:13px; white-space:nowrap; opacity:0.5;">🧩 Bước 3: Ghép vào Model</button>
                        <div style="flex:1; text-align:center;">
                            <img id="head-result-preview" src="" style="display:none; max-width:120px; border-radius:8px; border:2px solid rgba(54,209,220,0.4);" alt="final result">
                        </div>
                    </div>
                </div>

                <p style="font-size:11px; color:rgba(255,255,255,0.35); text-align:center; margin:0;">💡 Sau khi ghép, ảnh ở khu vực Preview bên trái sẽ tự động cập nhật với mặt mới.</p>
            `;

            document.body.appendChild(panel);

            // Fix composite button opacity when enabled
            const compositeBtn = panel.querySelector('#btn-head-composite');
            const observer = new MutationObserver(() => {
                compositeBtn.style.opacity = compositeBtn.disabled ? '0.5' : '1';
            });
            observer.observe(compositeBtn, { attributes: true, attributeFilter: ['disabled'] });
        },
    },
};
