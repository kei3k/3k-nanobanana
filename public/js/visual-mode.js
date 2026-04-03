/**
 * Visual Layer Mode (Visual Closet)
 * Bridges the simple UI with the underlying LiteGraph node system
 */

window.visualMode = {
    currentCategory: 'top',
    assets: [],
    equippedSlots: {
        head: null,
        face: null,
        top: null,
        bottom: null,
        footwear: null
    },
    defaultMannequinPath: '/images/placeholders/mannequin_default.png',
    currentBaseModelStr: null, // Holds base64 if custom uploaded
    
    // LiteGraph Node References
    nodes: {
        input: null,
        component: null,
        output: null
    },

    debounceTimer: null,

    init() {
        console.log('[VisualMode] Initializing Visual Closet...');
        this.setupEventListeners();
        this.fetchAssets('top');
        this.initWorkspace();
        this.renderLayerStack();
    },

    setupEventListeners() {
        // Intercept LiteGraph finish to update preview image
        const originalExecute = app.nodeEditor.executeWorkflow.bind(app.nodeEditor);
        app.nodeEditor.executeWorkflow = async () => {
            const overlay = document.getElementById('visual-loading-overlay');
            if (overlay) overlay.style.display = 'flex';
            
            try {
                await originalExecute();
                // When finished, the output image is in node-output-img
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
        // Setup hidden LiteGraph nodes for the Visual Mode
        const graph = app.nodeEditor.graph;
        graph.clear();

        // 1. Input Node
        const inputNode = LiteGraph.createNode('ff/image_input');
        inputNode.pos = [100, 200];
        graph.add(inputNode);
        
        // Load default mannequin base64
        this.loadDefaultMannequin(inputNode);

        // 2. Component Selector Node
        const compNode = LiteGraph.createNode('ff/component_selector');
        compNode.pos = [400, 150];
        compNode.properties.isOnePiece = false;
        // Make sure it preserves face
        compNode.properties.preserveFace = true;
        // Turn slots off by default
        ['head', 'face', 'top', 'bottom', 'footwear'].forEach(s => {
            compNode.properties[s].enabled = false;
        });
        graph.add(compNode);

        // 3. Output Node
        const outputNode = LiteGraph.createNode('ff/output');
        outputNode.pos = [800, 200];
        graph.add(outputNode);

        // Connect
        inputNode.connect(0, compNode, 0); // Input -> ComponentSelector
        compNode.connect(0, outputNode, 0); // ComponentSelector -> Output

        this.nodes.input = inputNode;
        this.nodes.component = compNode;
        this.nodes.output = outputNode;
    },

    async loadDefaultMannequin(inputNode) {
        try {
            const res = await fetch(this.defaultMannequinPath);
            if (!res.ok) return; // Ignore if placeholder isn't there yet
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                inputNode.properties.imageData = base64;
                this.currentBaseModelStr = e.target.result; // Data URL cache
            };
            reader.readAsDataURL(blob);
        } catch(e) {
            console.error('Failed to load default mannequin:', e);
        }
    },

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
                
                // Set logic
                this.currentBaseModelStr = dataUrl;
                if (this.nodes.input) {
                    this.nodes.input.properties.imageData = base64;
                    this.nodes.input.properties.fileName = file.name;
                    this.nodes.input.setDirtyCanvas(true);
                }

                // Update UI visually
                document.getElementById('base-model-thumb-img').src = dataUrl;
                document.getElementById('base-model-thumb-img').style.display = 'block';
                document.getElementById('base-model-name').textContent = file.name;
                
                // Render mannequin if no clothes, OR just run the workflow to rebuild
                this.triggerRender();
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    switchCategory(category) {
        this.currentCategory = category;
        
        // Update tabs UI
        document.querySelectorAll('.cat-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.cat === category);
        });

        const names = {
            head: 'Mũ & Tóc (Head)',
            face: 'Mặt & Kính (Face)',
            top: 'Áo (Top)',
            bottom: 'Quần (Bottom)',
            footwear: 'Giày (Footwear)'
        };
        document.getElementById('current-category-name').textContent = names[category] || category;

        this.fetchAssets(category);
    },

    async fetchAssets(category) {
        const grid = document.getElementById('asset-grid');
        grid.innerHTML = '<div style="padding:20px;font-size:12px;color:#888;">Đang tải...</div>';
        try {
            const res = await fetch(`/api/components?slot=${category}`);
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
            grid.innerHTML = '<div style="padding:20px;font-size:12px;color:#888;">Chưa có tài nguyên nào. Nhấn "+ Custom" để thêm.</div>';
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
        
        // 1. Update UI state
        this.equippedSlots[slot] = { id, thumbUrl, name, visible: true };
        this.renderLayerStack();

        // 2. Fetch base64 of the image to satisfy ComponentSelectorNode property
        try {
            // Need base64. Normally we might want high-res, but thumbnail is okay for style reference if it's clear
            // Let's use the actual reference path if possible. For simplicity, fetch the thumbUrl.
            const originalPath = thumbUrl.replace('/thumbnails/', '/originals/');
            const res = await fetch(originalPath);
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                this._syncNodeAndRun(slot, base64, name);
            };
            reader.readAsDataURL(blob);
        } catch (e) {
            console.error('Failed to convert dropped asset to base64', e);
        }
    },

    _syncNodeAndRun(slot, base64, desc) {
        if (!this.nodes.component) return;
        
        const compProp = this.nodes.component.properties[slot];
        if (compProp) {
            compProp.enabled = true;
            compProp.referenceImage = base64;
            compProp.description = desc;
        }

        this.nodes.component.setDirtyCanvas(true);
        this.triggerRender();
    },

    renderLayerStack() {
        const stack = document.getElementById('layer-stack');
        const slots = [
            { key: 'head', name: 'Đầu (Head)' },
            { key: 'face', name: 'Mặt (Face)' },
            { key: 'top', name: 'Áo (Top)' },
            { key: 'bottom', name: 'Quần (Bottom)' },
            { key: 'footwear', name: 'Giày (Footwear)' }
        ];

        let html = '';
        slots.forEach(s => {
            const equipped = this.equippedSlots[s.key];
            if (equipped) {
                const eyeIcon = equipped.visible ? '👁️' : '🕶️'; // Hidden eye icon
                html += `
                <div class="layer-item ${equipped.visible ? '' : 'hidden'}">
                    <button class="layer-visibility" onclick="visualMode.toggleVisibility('${s.key}')">${eyeIcon}</button>
                    <div class="layer-thumb"><img src="${equipped.thumbUrl}"></div>
                    <div class="layer-info">
                        <div class="layer-slot">${s.name}</div>
                        <div class="layer-name" title="${equipped.name}">${equipped.name}</div>
                    </div>
                    <button class="layer-remove" onclick="visualMode.removeEquip('${s.key}')">🗑️</button>
                </div>`;
            } else {
                html += `
                <div class="layer-item empty">
                    <div class="layer-thumb"></div>
                    <div class="layer-info">
                        <div class="layer-slot">${s.name}</div>
                        <div class="layer-name" style="color:var(--text-tertiary);">Chưa trang bị</div>
                    </div>
                </div>`;
            }
        });

        stack.innerHTML = html;
    },

    toggleVisibility(slot) {
        const equipped = this.equippedSlots[slot];
        if (!equipped) return;
        equipped.visible = !equipped.visible;
        this.renderLayerStack();

        // Sync node
        if (this.nodes.component) {
            this.nodes.component.properties[slot].enabled = equipped.visible;
            this.triggerRender();
        }
    },

    removeEquip(slot) {
        this.equippedSlots[slot] = null;
        this.renderLayerStack();

        if (this.nodes.component && this.nodes.component.properties[slot]) {
            this.nodes.component.properties[slot].enabled = false;
            this.nodes.component.properties[slot].referenceImage = null;
            this.triggerRender();
        }
    },

    resetOutfit() {
        const slots = ['head', 'face', 'top', 'bottom', 'footwear'];
        slots.forEach(s => {
            this.equippedSlots[s] = null;
            if (this.nodes.component && this.nodes.component.properties[s]) {
                this.nodes.component.properties[s].enabled = false;
                this.nodes.component.properties[s].referenceImage = null;
            }
        });
        document.getElementById('visual-preview-img').src = this.currentBaseModelStr || this.defaultMannequinPath;
        this.renderLayerStack();
    },

    triggerRender() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            // Check if any slot is actually enabled
            let hasEnabled = false;
            const slots = ['head', 'face', 'top', 'bottom', 'footwear'];
            for (const s of slots) {
                if (this.nodes.component.properties[s].enabled) hasEnabled = true;
            }

            if (!hasEnabled) {
                document.getElementById('visual-preview-img').src = this.currentBaseModelStr || this.defaultMannequinPath;
                return;
            }

            app.nodeEditor.executeWorkflow();
        }, 800);
    },

    downloadCurrent() {
        const imgUrl = document.getElementById('visual-preview-img').src;
        if (!imgUrl || imgUrl.endsWith('mannequin_default.png')) {
            app.showToast('Vui lòng mặc đồ trước khi lưu', 'warning');
            return;
        }
        const a = document.createElement('a');
        a.href = imgUrl;
        a.download = 'freefire_outfit_' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    openConvertModal() {
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
            formData.append('slot', this.currentCategory);
            formData.append('name', file.name.split('.')[0] + ' (Converted)');

            try {
                const res = await fetch('/api/assets/convert', { 
                    method: 'POST',
                    headers: {
                        'X-API-Key': localStorage.getItem('nanobana_api_key') || ''
                    },
                    body: formData
                });
                const data = await res.json();
                
                if (data.success) {
                    app.showToast('Chuyển đổi thành công!', 'success');
                    this.fetchAssets(this.currentCategory);
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
    }
};
