// =============================================================================
// 3K Nanobana — Main Application Controller
// =============================================================================
// Orchestrates all UI interactions: chat, sessions, versions, queue, masking
// =============================================================================

const app = {
    // ─── State ───────────────────────────────────────────────────────────────
    currentSession: null,
    currentVersionId: null,
    sessions: [],
    messages: [],
    isLoading: false,
    sseSource: null,
    pendingFile: null,
    referenceFiles: [],
    batchFiles: [],

    // Settings
    settings: {
        model: 'pro',
        imageSize: '1K',
        aspectRatio: '1:1',
        denoisingStrength: 0.5,
        seed: null,
        identityLock: false,
        texturePreservation: false,
        mask: null,
    },

    // ─── Initialization ──────────────────────────────────────────────────────
    async init() {
        console.log('[App] Initializing 3K Nanobana...');
        
        // Load sessions
        await this.loadSessions();
        
        // Setup drag & drop
        this._setupDragDrop();
        
        // Connect SSE for real-time updates
        this._connectSSE();

        // Load API Key
        const savedKey = localStorage.getItem('nanobana_api_key');
        if (savedKey) {
            const el = document.getElementById('api-key-input');
            if(el) el.value = savedKey;
        } else {
            // Warn user to set API key
            setTimeout(() => {
                this.showToast('⚠️ Chưa có API Key! Vui lòng nhập Gemini API Key ở phần ⚙️ Settings (bên phải) trước khi tạo ảnh.', 'warning', 8000);
            }, 1500);
        }
        
        // Input listener
        const input = document.getElementById('chat-input');
        if (input) {
            input.addEventListener('input', () => {
                const btn = document.getElementById('btn-send');
                btn.disabled = !input.value.trim() && !this.pendingFile && this.referenceFiles.length === 0;
            });
        }

        console.log('[App] Ready ✨');
    },

    // ─── Session Management ──────────────────────────────────────────────────
    async loadSessions() {
        try {
            const data = await API.listSessions();
            this.sessions = data.sessions || [];
            this._renderSessionList();
        } catch (err) {
            console.error('[App] Failed to load sessions:', err);
        }
    },

    async createSession() {
        try {
            const name = `Session ${this.sessions.length + 1}`;
            const data = await API.createSession(name, this.settings.model);
            
            this.currentSession = data.session;
            this.messages = [];
            this.currentVersionId = null;
            
            await this.loadSessions();
            this._activateSession();
            this.showToast('Session created', 'success');
        } catch (err) {
            this.showToast('Failed to create session: ' + err.message, 'error');
        }
    },

    async openSession(id) {
        try {
            const data = await API.getSession(id);
            this.currentSession = data.session;
            this.messages = data.messages || [];
            
            // Find latest version
            const versions = this.currentSession.versions || [];
            this.currentVersionId = versions.length > 0 
                ? versions[versions.length - 1].id 
                : null;

            this._activateSession();
            this._renderMessages();
            this._renderVersionTree();
        } catch (err) {
            this.showToast('Failed to load session: ' + err.message, 'error');
        }
    },

    async deleteSession(id, event) {
        event.stopPropagation();
        if (!confirm('Delete this session?')) return;
        
        try {
            await API.deleteSession(id);
            if (this.currentSession?.id === id) {
                this.currentSession = null;
                this.messages = [];
                this._deactivateSession();
            }
            await this.loadSessions();
            this.showToast('Session deleted', 'info');
        } catch (err) {
            this.showToast('Failed to delete: ' + err.message, 'error');
        }
    },

    _activateSession() {
        document.getElementById('chat-input-bar').style.display = 'block';
        const empty = document.getElementById('chat-empty');
        if (empty) empty.style.display = 'none';
        document.getElementById('session-title').textContent = this.currentSession?.name || 'Session';
        
        const modelBadge = document.getElementById('model-badge');
        modelBadge.style.display = 'inline-flex';
        modelBadge.textContent = this.currentSession?.model === 'pro' ? 'Nano Banana Pro' : 'Nano Banana 2';

        // Show version panel
        document.getElementById('version-panel').style.display = 'block';
        
        // Highlight active session in sidebar
        document.querySelectorAll('.session-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === this.currentSession?.id);
        });

        // Focus input
        document.getElementById('chat-input')?.focus();
    },

    _deactivateSession() {
        document.getElementById('chat-input-bar').style.display = 'none';
        document.getElementById('chat-empty').style.display = 'flex';
        document.getElementById('session-title').textContent = 'Welcome';
        document.getElementById('model-badge').style.display = 'none';
        document.getElementById('version-panel').style.display = 'none';
        document.getElementById('chat-messages').innerHTML = `
            <div class="chat-empty" id="chat-empty">
                <div class="chat-empty-content">
                    <div class="chat-empty-icon">🍌</div>
                    <div class="chat-empty-title">Nanobana AI Image Editor</div>
                    <div class="chat-empty-desc">
                        Upload an image to start editing, or describe what you want to create.
                        <br>Powered by <strong>Nano Banana Pro</strong> (Gemini 3 Pro Image).
                    </div>
                    <div style="margin-top: 20px; display: flex; gap: 8px; justify-content: center;">
                        <button class="btn btn-primary" onclick="app.createSession()">+ New Session</button>
                        <button class="btn btn-secondary" onclick="app.openBatchModal()">Batch Processing</button>
                    </div>
                </div>
            </div>
        `;
    },

    _renderSessionList() {
        const list = document.getElementById('session-list');
        if (this.sessions.length === 0) {
            list.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
                    No sessions yet.<br>Create one to get started.
                </div>
            `;
            return;
        }

        list.innerHTML = this.sessions.map(s => `
            <div class="session-item ${this.currentSession?.id === s.id ? 'active' : ''}" 
                 data-id="${s.id}" onclick="app.openSession('${s.id}')">
                <div class="session-item-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;background:var(--bg-tertiary);">
                    ${s.thumbnail_path ? `<img src="/api/images/thumbnails/${s.thumbnail_path.split(/[/\\]/).pop()}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);">` : '🖼️'}
                </div>
                <div class="session-item-info">
                    <div class="session-item-name truncate">${this._escapeHtml(s.name)}</div>
                    <div class="session-item-meta">${this._formatDate(s.updated_at || s.created_at)}</div>
                </div>
                <button class="btn btn-ghost btn-icon-sm session-item-delete" 
                        onclick="app.deleteSession('${s.id}', event)" data-tooltip="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `).join('');
    },

    // ─── Chat / Messaging ────────────────────────────────────────────────────
    async sendMessage() {
        const input = document.getElementById('chat-input');
        const prompt = input.value.trim();
        
        if (!prompt && !this.pendingFile) return;
        if (!this.currentSession) {
            await this.createSession();
        }
        if (this.isLoading) return;

        // Warn if no API key
        if (!localStorage.getItem('nanobana_api_key')) {
            this.showToast('🔐 Vui lòng nhập Gemini API Key ở phần ⚙️ Settings trước khi tạo ảnh!', 'error', 5000);
            return;
        }

        this.isLoading = true;
        const sendBtn = document.getElementById('btn-send');
        sendBtn.disabled = true;

        try {
            // If there's a pending file and no messages yet, upload first
            if (this.pendingFile && (!this.currentSession.versions || this.currentSession.versions.length === 0)) {
                this._addMessageToUI('user', `📸 Uploading image...`);
                const uploadResult = await API.uploadImage(this.currentSession.id, this.pendingFile);
                
                if (uploadResult.success) {
                    this._addImageMessageToUI('assistant', 'Original image uploaded ✓', 
                        uploadResult.image.path, uploadResult.version);
                    this.currentVersionId = uploadResult.version.id;
                    // Refresh session to get version tree
                    const refreshed = await API.getSession(this.currentSession.id);
                    this.currentSession = refreshed.session;
                    this._renderVersionTree();
                }
                this.pendingFile = null;
                this._clearUploadPreview();
            }

            // If there's a prompt, send the edit
            if (prompt) {
                this._addMessageToUI('user', prompt);
                input.value = '';
                this.autoResizeInput(input);

                // Show typing indicator
                this._showTyping();

                const params = {
                    prompt,
                    parentVersionId: this.currentVersionId,
                    model: this.settings.model,
                    aspectRatio: this.settings.aspectRatio,
                    imageSize: this.settings.imageSize,
                    denoisingStrength: this.settings.denoisingStrength,
                    seed: this.settings.seed,
                    identityLock: this.settings.identityLock,
                    texturePreservation: this.settings.texturePreservation,
                    mask: this.settings.mask,
                };

                // Send with reference images if any
                const result = await API.sendChat(this.currentSession.id, params, this.referenceFiles);

                this._hideTyping();

                if (result.success && result.image) {
                    this._addImageMessageToUI('assistant', result.text || '', 
                        result.image.path, result.version);
                    this.currentVersionId = result.version.id;
                    
                    // Clear mask and reference images after successful edit
                    this.settings.mask = null;
                    this.clearRefFiles();
                } else {
                    this._addMessageToUI('assistant', result.text || 'No image generated. Try a different prompt.');
                }

                // Refresh version tree
                const refreshed = await API.getSession(this.currentSession.id);
                this.currentSession = refreshed.session;
                this._renderVersionTree();
            }

        } catch (err) {
            this._hideTyping();
            this._addMessageToUI('assistant', `❌ Error: ${err.message}`);
            this.showToast(err.message, 'error');
        } finally {
            this.isLoading = false;
            sendBtn.disabled = !input.value.trim();
        }
    },

    handleInputKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    },

    autoResizeInput(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
    },

    // ─── Message UI Rendering ────────────────────────────────────────────────
    _addMessageToUI(role, text) {
        const container = document.getElementById('chat-messages');
        const empty = document.getElementById('chat-empty');
        if (empty) empty.style.display = 'none';

        const msg = document.createElement('div');
        msg.className = `message ${role}`;
        msg.innerHTML = `
            <div class="message-avatar">${role === 'user' ? '👤' : '🍌'}</div>
            <div class="message-content">
                <div class="message-text">${this._escapeHtml(text)}</div>
                <div class="message-timestamp">${this._formatTime(new Date())}</div>
            </div>
        `;
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    },

    _addImageMessageToUI(role, text, imagePath, version) {
        const container = document.getElementById('chat-messages');
        const empty = document.getElementById('chat-empty');
        if (empty) empty.style.display = 'none';

        const versionBadge = version 
            ? `<span class="message-version-badge">V${version.version_number}</span>` 
            : '';
        
        const versionActions = version ? `
            <div class="message-actions">
                ${versionBadge}
                <button class="btn btn-ghost btn-sm" onclick="app.branchFromVersion('${version.id}')">🌿 Branch</button>
                <button class="btn btn-ghost btn-sm" onclick="app.upscaleVersion('${version.id}')">⬆️ 4K</button>
                <button class="btn btn-ghost btn-sm" onclick="app.downloadImage('${imagePath}')">💾 Save</button>
            </div>
        ` : '';

        const msg = document.createElement('div');
        msg.className = `message ${role}`;
        msg.innerHTML = `
            <div class="message-avatar">${role === 'user' ? '👤' : '🍌'}</div>
            <div class="message-content">
                ${text ? `<div class="message-text">${this._escapeHtml(text)}</div>` : ''}
                <div class="message-image">
                    <img src="${imagePath}" alt="Generated image" onclick="app.openLightbox('${imagePath}')" loading="lazy">
                </div>
                ${versionActions}
                <div class="message-timestamp">${this._formatTime(new Date())}</div>
            </div>
        `;
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    },

    _renderMessages() {
        const container = document.getElementById('chat-messages');

        if (!this.messages || this.messages.length === 0) {
            container.innerHTML = `
            <div class="chat-empty" id="chat-empty">
                <div class="chat-empty-content">
                    <div class="chat-empty-icon">🍌</div>
                    <div class="chat-empty-title">Nanobana AI Image Editor</div>
                    <div class="chat-empty-desc">
                        Upload an image to start editing, or describe what you want to create.
                        <br>Powered by <strong>Nano Banana Pro</strong> (Gemini 3 Pro Image).
                    </div>
                    <div style="margin-top: 20px; display: flex; gap: 8px; justify-content: center;">
                        <button class="btn btn-primary" onclick="app.createSession()">+ New Session</button>
                        <button class="btn btn-secondary" onclick="app.openBatchModal()">Batch Processing</button>
                    </div>
                </div>
            </div>
            `;
            return;
        }

        container.innerHTML = '';

        for (const msg of this.messages) {
            if (msg.image_path) {
                // Find matching version
                const version = this.currentSession?.versions?.find(v => v.id === msg.version_id);
                const imgPath = msg.role === 'user'
                    ? `/api/images/originals/${msg.image_path.split(/[/\\]/).pop()}`
                    : `/api/images/generated/${msg.image_path.split(/[/\\]/).pop()}`;
                this._addImageMessageToUI(msg.role, msg.content, imgPath, version);
            } else if (msg.content) {
                this._addMessageToUI(msg.role, msg.content);
            }
        }
    },

    _showTyping() {
        const container = document.getElementById('chat-messages');
        const typing = document.createElement('div');
        typing.className = 'message assistant';
        typing.id = 'typing-indicator';
        typing.innerHTML = `
            <div class="message-avatar">🍌</div>
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        container.appendChild(typing);
        container.scrollTop = container.scrollHeight;
    },

    _hideTyping() {
        const typing = document.getElementById('typing-indicator');
        if (typing) typing.remove();
    },

    // ─── File Upload ─────────────────────────────────────────────────────────
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.pendingFile = file;
        this._showUploadPreview(file);
        document.getElementById('btn-send').disabled = false;
    },

    _showUploadPreview(file) {
        const preview = document.getElementById('upload-preview');
        preview.classList.add('active');
        
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `
                <div class="upload-preview-item">
                    <img src="${e.target.result}" alt="Upload preview">
                    <button class="upload-preview-remove" onclick="app._clearUploadPreview()">×</button>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    },

    _clearUploadPreview() {
        const preview = document.getElementById('upload-preview');
        preview.classList.remove('active');
        preview.innerHTML = '';
        this.pendingFile = null;
        document.getElementById('file-input').value = '';
    },

    // ─── Reference Images ────────────────────────────────────────────────────
    handleRefFileSelect(event) {
        const files = Array.from(event.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;

        // Enforce max 14 reference images (Gemini limit)
        const remaining = 14 - this.referenceFiles.length;
        if (remaining <= 0) {
            this.showToast('Tối đa 14 ảnh tham chiếu!', 'warning');
            return;
        }
        const toAdd = files.slice(0, remaining);
        this.referenceFiles.push(...toAdd);
        this._renderRefPreview();
        document.getElementById('btn-send').disabled = false;
        // Reset input so same files can be re-selected
        event.target.value = '';
    },

    _renderRefPreview() {
        const container = document.getElementById('ref-preview');
        if (this.referenceFiles.length === 0) {
            container.classList.remove('active');
            container.innerHTML = '';
            return;
        }
        container.classList.add('active');

        let html = `<span class="ref-preview-label">📎 Ảnh tham chiếu (${this.referenceFiles.length})</span>`;

        this.referenceFiles.forEach((file, idx) => {
            const url = URL.createObjectURL(file);
            html += `
                <div class="ref-preview-item">
                    <img src="${url}" alt="Ref ${idx + 1}">
                    <button class="upload-preview-remove" onclick="app.removeRefFile(${idx})">×</button>
                </div>
            `;
        });

        html += `<button class="ref-preview-clear" onclick="app.clearRefFiles()">Xoá tất cả</button>`;
        container.innerHTML = html;
    },

    removeRefFile(index) {
        this.referenceFiles.splice(index, 1);
        this._renderRefPreview();
        const input = document.getElementById('chat-input');
        document.getElementById('btn-send').disabled = !input.value.trim() && !this.pendingFile && this.referenceFiles.length === 0;
    },

    clearRefFiles() {
        this.referenceFiles = [];
        this._renderRefPreview();
        document.getElementById('ref-file-input').value = '';
    },

    // ─── Drag & Drop ─────────────────────────────────────────────────────────
    _setupDragDrop() {
        const overlay = document.getElementById('drop-overlay');
        let dragCounter = 0;

        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            overlay.classList.add('active');
        });

        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                overlay.classList.remove('active');
                dragCounter = 0;
            }
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.remove('active');

            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length > 0) {
                this.pendingFile = files[0];
                this._showUploadPreview(files[0]);
                document.getElementById('btn-send').disabled = false;
            }
        });
    },

    // ─── Version Tree ────────────────────────────────────────────────────────
    _renderVersionTree() {
        const container = document.getElementById('version-tree');
        const versions = this.currentSession?.versions || [];

        if (versions.length === 0) {
            container.innerHTML = '<div style="padding:8px;color:var(--text-tertiary);font-size:12px;">No versions yet. Upload an image to begin.</div>';
            return;
        }

        container.innerHTML = versions.map((v, i) => `
            <div class="version-node ${v.id === this.currentVersionId ? 'active' : ''}" 
                 onclick="app.selectVersion('${v.id}')">
                <div class="version-node-dot"></div>
                <div class="version-node-info">
                    <div class="version-node-label">V${v.version_number}${v.id === this.currentVersionId ? ' (current)' : ''}</div>
                    <div class="version-node-prompt truncate">${this._escapeHtml(v.prompt || 'Original')}</div>
                </div>
                <div class="version-node-actions">
                    <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation();app.branchFromVersion('${v.id}')" data-tooltip="Branch">🌿</button>
                    <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation();app.upscaleVersion('${v.id}')" data-tooltip="Upscale 4K">⬆️</button>
                </div>
            </div>
        `).join('');
    },

    selectVersion(versionId) {
        this.currentVersionId = versionId;
        this._renderVersionTree();
        this.showToast(`Switched to V${this.currentSession.versions.find(v => v.id === versionId)?.version_number}`, 'info');
    },

    async branchFromVersion(versionId) {
        this.currentVersionId = versionId;
        this._renderVersionTree();
        const v = this.currentSession.versions.find(v => v.id === versionId);
        this.showToast(`Branching from V${v?.version_number}. Type your next edit.`, 'info');
        document.getElementById('chat-input')?.focus();
    },

    async upscaleVersion(versionId) {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            this.showToast('Upscaling to 4K...', 'info');
            const result = await API.upscale(
                this.currentSession.id, 
                versionId,
                this.settings.aspectRatio
            );
            
            if (result.success) {
                this._addImageMessageToUI('assistant', '⬆️ Upscaled to 4K', 
                    result.image.path, result.version);
                this.currentVersionId = result.version.id;
                
                const refreshed = await API.getSession(this.currentSession.id);
                this.currentSession = refreshed.session;
                this._renderVersionTree();
                this.showToast('Upscale complete!', 'success');
            }
        } catch (err) {
            this.showToast('Upscale failed: ' + err.message, 'error');
        } finally {
            this.isLoading = false;
        }
    },

    // ─── Settings Controls ───────────────────────────────────────────────────
    selectModel(model) {
        this.settings.model = model;
        document.querySelectorAll('.model-card').forEach(el => {
            el.classList.toggle('active', el.dataset.model === model);
        });
        
        const badge = document.getElementById('model-badge');
        badge.textContent = model === 'pro' ? 'Nano Banana Pro' : 'Nano Banana 2';
    },

    selectResolution(size) {
        this.settings.imageSize = size;
        document.querySelectorAll('.resolution-btn[data-size]').forEach(el => {
            el.classList.toggle('active', el.dataset.size === size);
        });
    },

    selectAspectRatio(ratio) {
        this.settings.aspectRatio = ratio;
        document.querySelectorAll('.aspect-ratio-btn').forEach(el => {
            el.classList.toggle('active', el.dataset.ratio === ratio);
        });
    },

    updateDenoising(value) {
        this.settings.denoisingStrength = parseFloat(value);
        document.getElementById('denoising-value').textContent = value;
    },

    updateSeed(value) {
        this.settings.seed = value ? parseInt(value) : null;
    },

    randomizeSeed() {
        const seed = Math.floor(Math.random() * 99999);
        document.getElementById('seed-input').value = seed;
        this.settings.seed = seed;
    },

    toggleIdentityLock() {
        this.settings.identityLock = !this.settings.identityLock;
        document.getElementById('toggle-identity').classList.toggle('active', this.settings.identityLock);
    },

    toggleTexturePreserve() {
        this.settings.texturePreservation = !this.settings.texturePreservation;
        document.getElementById('toggle-texture').classList.toggle('active', this.settings.texturePreservation);
    },

    saveApiKey(value) {
        if (value.trim()) {
            localStorage.setItem('nanobana_api_key', value.trim());
            this.showToast('API Key saved locally', 'success');
        } else {
            localStorage.removeItem('nanobana_api_key');
            this.showToast('API Key cleared', 'info');
        }
    },

    // ─── Masking ─────────────────────────────────────────────────────────────
    async openMaskEditor() {
        if (!this.currentVersionId || !this.currentSession) {
            this.showToast('Upload an image first to use the masking tool', 'warning');
            return;
        }

        const version = this.currentSession.versions?.find(v => v.id === this.currentVersionId);
        if (!version) return;

        const imgPath = version.prompt === 'Original Upload'
            ? `/api/images/originals/${version.image_path.split(/[/\\]/).pop()}`
            : `/api/images/generated/${version.image_path.split(/[/\\]/).pop()}`;

        document.getElementById('mask-overlay').classList.add('active');
        await MaskTool.init(imgPath);
    },

    closeMaskEditor() {
        document.getElementById('mask-overlay').classList.remove('active');
        MaskTool.destroy();
    },

    setMaskTool(tool) {
        MaskTool.setTool(tool);
    },

    updateBrushSize(size) {
        MaskTool.setBrushSize(size);
        document.getElementById('mask-size-value').textContent = size;
    },

    clearMask() {
        MaskTool.clear();
    },

    applyMask() {
        const bounds = MaskTool.calculateMaskBounds();
        if (bounds) {
            this.settings.mask = bounds;
            this.showToast('Mask applied — edits will target the selected region', 'success');
        } else {
            this.settings.mask = null;
            this.showToast('No mask detected', 'warning');
        }
        this.closeMaskEditor();
    },

    // ─── Batch Processing ────────────────────────────────────────────────────
    openBatchModal() {
        document.getElementById('batch-modal').classList.add('active');
        this.batchFiles = [];
        document.getElementById('batch-preview-grid').innerHTML = '';
        document.getElementById('btn-start-batch').disabled = true;
    },

    closeBatchModal() {
        document.getElementById('batch-modal').classList.remove('active');
        this.batchFiles = [];
    },

    handleBatchFiles(event) {
        const files = Array.from(event.target.files).filter(f => f.type.startsWith('image/'));
        this.batchFiles = files;
        
        const grid = document.getElementById('batch-preview-grid');
        grid.innerHTML = '';
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const item = document.createElement('div');
                item.className = 'batch-preview-item';
                item.innerHTML = `<img src="${e.target.result}" alt="${file.name}">`;
                grid.appendChild(item);
            };
            reader.readAsDataURL(file);
        });

        document.getElementById('btn-start-batch').disabled = files.length === 0;
    },

    async startBatchProcessing() {
        const prompt = document.getElementById('batch-prompt').value.trim();
        if (!prompt) return this.showToast('Please enter an edit prompt', 'warning');
        if (this.batchFiles.length === 0) return this.showToast('No images selected', 'warning');

        try {
            const result = await API.createBatch(this.batchFiles, prompt, {
                model: this.settings.model,
                aspectRatio: this.settings.aspectRatio,
                imageSize: this.settings.imageSize,
                denoisingStrength: this.settings.denoisingStrength.toString(),
                seed: this.settings.seed?.toString() || '',
                identityLock: this.settings.identityLock.toString(),
                texturePreservation: this.settings.texturePreservation.toString(),
            });

            this.closeBatchModal();
            this.showToast(`Batch started: ${result.batch.totalCount} images queued`, 'success');
            
            // Switch to queue tab
            this.switchSidebarTab('queue');
        } catch (err) {
            this.showToast('Batch failed: ' + err.message, 'error');
        }
    },

    // ─── SSE Real-time Updates ───────────────────────────────────────────────
    _connectSSE() {
        this.sseSource = API.connectSSE((event) => {
            switch (event.type) {
                case 'queue:item:completed':
                    this._updateQueueUI();
                    break;
                case 'queue:item:failed':
                    this._updateQueueUI();
                    break;
                case 'batch:progress':
                    this._updateBatchProgress(event.data);
                    break;
                case 'queue:idle':
                    this.showToast('All queue tasks completed', 'success');
                    break;
            }
        });
    },

    async _updateQueueUI() {
        // Refresh queue stats if we're on the queue tab
        if (document.querySelector('.sidebar-nav-tab[data-tab="queue"]')?.classList.contains('active')) {
            await this._renderQueueView();
        }
    },

    _updateBatchProgress(data) {
        const progressBar = document.querySelector(`[data-batch-progress="${data.id}"]`);
        if (progressBar) {
            const pct = data.total > 0 ? Math.round((data.completed + data.failed) / data.total * 100) : 0;
            progressBar.querySelector('.progress-bar-fill').style.width = pct + '%';
            progressBar.querySelector('.batch-progress-text').textContent = 
                `${data.completed}/${data.total} done${data.failed > 0 ? `, ${data.failed} failed` : ''}`;
        }
    },

    // ─── Sidebar Tabs ────────────────────────────────────────────────────────
    async switchSidebarTab(tab) {
        document.querySelectorAll('.sidebar-nav-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });

        const sessionList = document.getElementById('session-list');
        
        if (tab === 'sessions') {
            this._renderSessionList();
        } else if (tab === 'queue') {
            await this._renderQueueView();
        }
    },

    async _renderQueueView() {
        const container = document.getElementById('session-list');
        
        try {
            const [statsData, batchData] = await Promise.all([
                API.getQueueStats(),
                API.listBatches(),
            ]);

            const stats = statsData.stats || {};
            const batches = batchData.batches || [];

            container.innerHTML = `
                <div style="padding: 12px;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px;">
                        <div style="padding:10px;background:var(--bg-tertiary);border-radius:var(--radius-md);text-align:center;">
                            <div style="font-size:20px;font-weight:700;color:var(--warning);font-family:var(--font-mono);">${stats.pending || 0}</div>
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;">Pending</div>
                        </div>
                        <div style="padding:10px;background:var(--bg-tertiary);border-radius:var(--radius-md);text-align:center;">
                            <div style="font-size:20px;font-weight:700;color:var(--info);font-family:var(--font-mono);">${stats.processing || 0}</div>
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;">Processing</div>
                        </div>
                        <div style="padding:10px;background:var(--bg-tertiary);border-radius:var(--radius-md);text-align:center;">
                            <div style="font-size:20px;font-weight:700;color:var(--success);font-family:var(--font-mono);">${stats.completed || 0}</div>
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;">Done</div>
                        </div>
                        <div style="padding:10px;background:var(--bg-tertiary);border-radius:var(--radius-md);text-align:center;">
                            <div style="font-size:20px;font-weight:700;color:var(--error);font-family:var(--font-mono);">${stats.failed || 0}</div>
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;">Failed</div>
                        </div>
                    </div>
                    
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary);margin-bottom:8px;">
                        Batch Jobs
                    </div>
                    ${batches.length === 0 
                        ? '<div style="color:var(--text-tertiary);font-size:12px;padding:16px 0;">No batch jobs yet.</div>'
                        : batches.map(b => `
                            <div style="padding:12px;background:var(--bg-tertiary);border-radius:var(--radius-md);margin-bottom:8px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                                    <span style="font-size:12px;font-weight:600;">${this._escapeHtml(b.name)}</span>
                                    <span class="badge badge-${b.status === 'completed' ? 'success' : b.status === 'failed' ? 'error' : 'info'}">${b.status}</span>
                                </div>
                                <div data-batch-progress="${b.id}">
                                    <div class="progress-bar" style="margin-bottom:4px;">
                                        <div class="progress-bar-fill" style="width:${b.total_count > 0 ? Math.round((b.completed_count + b.failed_count) / b.total_count * 100) : 0}%"></div>
                                    </div>
                                    <span class="batch-progress-text" style="font-size:10px;color:var(--text-tertiary);">
                                        ${b.completed_count}/${b.total_count} done${b.failed_count > 0 ? `, ${b.failed_count} failed` : ''}
                                    </span>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<div style="padding:16px;color:var(--error);font-size:12px;">Error loading queue: ${err.message}</div>`;
        }
    },

    // ─── UI Toggles ──────────────────────────────────────────────────────────
    toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('open');
    },

    togglePanel() {
        document.getElementById('right-panel').classList.toggle('open');
    },

    openLightbox(src) {
        document.getElementById('lightbox-img').src = src;
        document.getElementById('lightbox').classList.add('active');
    },

    closeLightbox() {
        document.getElementById('lightbox').classList.remove('active');
    },

    downloadImage(path) {
        const a = document.createElement('a');
        a.href = path;
        a.download = path.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    // ─── Toast Notifications ─────────────────────────────────────────────────
    showToast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // ─── Utility ─────────────────────────────────────────────────────────────
    _escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    _formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return d.toLocaleDateString();
    },

    _formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
};

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => app.init());
