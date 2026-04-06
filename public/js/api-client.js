// =============================================================================
// 3K Nanobana — Frontend API Client
// =============================================================================
// Handles all HTTP requests to the backend API
// =============================================================================

const API = {
    BASE: '/api',

    // ─── Helper ──────────────────────────────────────────────────────────────
    async request(method, path, data = null, isFormData = false) {
        const options = {
            method,
            headers: {},
        };

        const apiKey = localStorage.getItem('nanobana_api_key');
        if (apiKey) {
            options.headers['x-api-key'] = apiKey;
        }

        if (data) {
            if (isFormData) {
                options.body = data; // FormData sets its own Content-Type
            } else {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(data);
            }
        }

        const response = await fetch(`${this.BASE}${path}`, options);
        const json = await response.json();

        if (!response.ok) {
            throw new Error(json.error || `HTTP ${response.status}`);
        }

        return json;
    },

    // ─── Models ──────────────────────────────────────────────────────────────
    async getModels() {
        return this.request('GET', '/models');
    },

    // ─── Sessions ────────────────────────────────────────────────────────────
    async createSession(name, model) {
        return this.request('POST', '/sessions', { name, model });
    },

    async listSessions() {
        return this.request('GET', '/sessions');
    },

    async getSession(id) {
        return this.request('GET', `/sessions/${id}`);
    },

    async deleteSession(id) {
        return this.request('DELETE', `/sessions/${id}`);
    },

    // ─── Image Upload ────────────────────────────────────────────────────────
    async fetchImageUrl(url) {
        return this.request('POST', '/fetch-url', { url });
    },

    async uploadImage(sessionId, file) {
        const formData = new FormData();
        formData.append('image', file);
        return this.request('POST', `/sessions/${sessionId}/upload`, formData, true);
    },

    // ─── Chat Edit ───────────────────────────────────────────────────────────
    async sendChat(sessionId, params, referenceFiles = []) {
        if (referenceFiles.length > 0) {
            // Use FormData to upload reference images alongside the prompt
            const formData = new FormData();
            Object.keys(params).forEach(key => {
                const val = params[key];
                if (val !== null && val !== undefined) {
                    formData.append(key, typeof val === 'object' ? JSON.stringify(val) : val);
                }
            });
            referenceFiles.forEach(f => formData.append('referenceImages', f));
            return this.request('POST', `/sessions/${sessionId}/chat`, formData, true);
        }
        return this.request('POST', `/sessions/${sessionId}/chat`, params);
    },

    // ─── Upscale ─────────────────────────────────────────────────────────────
    async upscale(sessionId, versionId, aspectRatio) {
        return this.request('POST', `/sessions/${sessionId}/upscale/${versionId}`, { aspectRatio });
    },

    // ─── Branch ──────────────────────────────────────────────────────────────
    async branch(sessionId, versionId) {
        return this.request('POST', `/sessions/${sessionId}/branch/${versionId}`);
    },

    // ─── Batch ───────────────────────────────────────────────────────────────
    async createBatch(files, prompt, config = {}) {
        const formData = new FormData();
        files.forEach(f => formData.append('images', f));
        formData.append('prompt', prompt);
        Object.keys(config).forEach(k => formData.append(k, config[k]));
        return this.request('POST', '/batch', formData, true);
    },

    async listBatches() {
        return this.request('GET', '/batch');
    },

    async getBatch(id) {
        return this.request('GET', `/batch/${id}`);
    },

    // ─── Queue ───────────────────────────────────────────────────────────────
    async getQueueStats() {
        return this.request('GET', '/queue/stats');
    },

    // ─── Generate ────────────────────────────────────────────────────────────
    async generate(prompt, config = {}) {
        return this.request('POST', '/generate', { prompt, ...config });
    },

    // ─── SSE Stream ──────────────────────────────────────────────────────────
    connectSSE(onEvent) {
        const source = new EventSource(`${this.BASE}/queue/stream`);
        
        source.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onEvent(data);
            } catch (e) {
                console.warn('[SSE] Parse error:', e);
            }
        };

        source.onerror = (err) => {
            console.warn('[SSE] Connection error, reconnecting...');
            // EventSource auto-reconnects
        };

        return source;
    },
};
