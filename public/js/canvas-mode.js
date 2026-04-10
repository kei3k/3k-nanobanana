/**
 * 3K FreeFire Studio - Canvas Mode (Character Sheet Builder)
 * Uses Fabric.js to create an interactive multi-pose layout
 */

class CanvasMode {
    constructor() {
        this.canvas = null;
        this.isInitialized = false;
        this.baseImage = null; // The processed character image to generate poses from
        this.isCancelled = false; // Flag to stop loop
    }

    init() {
        if (this.isInitialized) return;
        
        // Ensure Fabric.js is loaded
        if (typeof fabric === 'undefined') {
            console.error('Fabric.js not loaded!');
            return;
        }

        // Initialize Fabric canvas
        this.canvas = new fabric.Canvas('multi-pose-canvas', {
            width: 3072,
            height: 1204,
            backgroundColor: '#808080',
            preserveObjectStacking: true // Keep selected objects at their z-index
        });

        // Set up drop events from desktop for reference images
        const container = document.getElementById('fabric-container');
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            container.style.border = '2px dashed var(--accent-primary)';
        });
        container.addEventListener('dragleave', (e) => {
            e.preventDefault();
            container.style.border = 'none';
        });
        container.addEventListener('drop', (e) => {
            e.preventDefault();
            container.style.border = 'none';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    this.addImageToCanvasFromFile(file);
                }
            }
        });

        // Delete key listener
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Check if we are not in an input field
                if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                    this.deleteSelected();
                }
            }
        });

        this.scaleCanvasToScreen();
        window.addEventListener('resize', () => this.scaleCanvasToScreen());

        this.isInitialized = true;
        console.log('[CanvasMode] Initialized successfully');
    }

    scaleCanvasToScreen() {
        if (!this.canvas) return;
        const workspace = document.querySelector('#canvas-workspace .visual-center');
        if (!workspace || workspace.clientWidth === 0) return;
        
        const padding = 48; // 24px padding on each side
        const availableWidth = workspace.clientWidth - padding;
        
        const originalWidth = parseInt(document.getElementById('canvas-width').value) || 3072;
        const originalHeight = parseInt(document.getElementById('canvas-height').value) || 1204;
        
        // Calculate zoom to fit in screen
        let scale = availableWidth / originalWidth;
        if (scale > 1) scale = 1; // Don't scale up if screen is huge
        
        // Use Fabric's native zoom instead of CSS transform so mouse events stay precise
        this.canvas.setZoom(scale);
        this.canvas.setWidth(originalWidth * scale);
        this.canvas.setHeight(originalHeight * scale);
        this.canvas.originalWidth = originalWidth;
        this.canvas.originalHeight = originalHeight;
    }

    resizeCanvas() {
        this.scaleCanvasToScreen();
        this.canvas.renderAll();
    }

    showLoading(text) {
        document.getElementById('canvas-loading-text').innerText = text;
        const spinner = document.getElementById('canvas-spinner');
        if (spinner) spinner.style.display = 'block';
        const retryBtn = document.getElementById('canvas-btn-retry-overlay');
        if (retryBtn) retryBtn.style.display = 'none';
        
        document.getElementById('canvas-loading-overlay').style.display = 'flex';
    }

    showErrorOverlay(text) {
        document.getElementById('canvas-loading-text').innerText = '❌ ' + text;
        const spinner = document.getElementById('canvas-spinner');
        if (spinner) spinner.style.display = 'none';
        const retryBtn = document.getElementById('canvas-btn-retry-overlay');
        if (retryBtn) retryBtn.style.display = 'block';
    }

    hideLoading() {
        document.getElementById('canvas-loading-overlay').style.display = 'none';
    }

    retryGeneration() {
        if (this.lastAction) {
            if (this.lastAction.type === 'multi') {
                this.generatePoses(this.lastAction.startIndex || 0);
            } else if (this.lastAction.type === 'single') {
                this.generateSinglePose(this.lastAction.perspective);
            }
        }
    }

    // Add image via Data URL
    addImageToCanvas(dataUrl, options = {}) {
        fabric.Image.fromURL(dataUrl, (img) => {
            if (options.scale) img.scale(options.scale);
            if (options.left !== undefined) img.set({ left: options.left });
            if (options.top !== undefined) img.set({ top: options.top });
            
            // Default position if not specified
            if (options.left === undefined && options.top === undefined) {
                const centerScale = 1 / this.canvas.getZoom();
                img.set({
                    left: (this.canvas.width / 2 * centerScale) - ((img.width * img.scaleX) / 2),
                    top: (this.canvas.height / 2 * centerScale) - ((img.height * img.scaleY) / 2)
                });
            }

            img.set({ cornerColor: '#7c6aff', borderColor: '#7c6aff', transparentCorners: false });
            
            this.canvas.add(img);
            this.canvas.setActiveObject(img);
            this.canvas.renderAll();
        });
    }

    addImageToCanvasFromFile(file) {
        const reader = new FileReader();
        reader.onload = (f) => this.addImageToCanvas(f.target.result);
        reader.readAsDataURL(file);
    }

    uploadLocalImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                this.addImageToCanvasFromFile(e.target.files[0]);
            }
        };
        input.click();
    }

    transferCurrentVisualToCanvas() {
        if (!window.visualMode) return;
        const imgUrl = document.getElementById('visual-preview-img').src;
        if (!imgUrl || imgUrl.endsWith('mannequin_default.png')) {
            app.showToast('Vui lòng tạo hình bên tab Mặc Đồ trước', 'warning');
            return;
        }

        // Set as base image for poses
        this.baseImage = imgUrl;
        
        // Deep copy the current references from Visual Mode to avoid hallucination during generation
        this.equippedState = {};
        if (window.visualMode.equippedState) {
            // we safely clone it so it doesn't get messed up
            this.equippedState = JSON.parse(JSON.stringify(window.visualMode.equippedState));
        }

        // Fetch to get base64
        fetch(imgUrl).then(res => res.blob()).then(blob => {
            const reader = new FileReader();
            reader.onloadend = () => {
                this.addImageToCanvas(reader.result, { scale: 1, left: 100, top: 100 });
                app.showToast('Đã thêm ảnh gốc vào Canvas', 'success');
            };
            reader.readAsDataURL(blob);
        });
    }

    deleteSelected() {
        const activeObj = this.canvas.getActiveObject();
        if (activeObj) {
            this.canvas.remove(activeObj);
        }
    }

    cancelGeneration() {
        this.isCancelled = true;
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }
        if (this.abortControllers && this.abortControllers.length > 0) {
            this.abortControllers.forEach(ac => ac.abort());
            this.abortControllers = [];
        }
        app.showToast('Đã nhận lệnh Dừng! Luồng sinh bị ngắt tức khắc.', 'warning');
        
        const overlay = document.getElementById('canvas-loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // --- AI Generation Functions ---

    /**
     * Executes the generation of 4 poses
     * Runs 4 independent requests to Gemni to avoid timeout
     */
    async generatePoses(startIndex = 0) {
        this.lastAction = { type: 'multi', startIndex };
        
        let generationSourceBase64 = null;
        let generationReferenceImage = this.baseImage;

        // Ưu tiên 1: Ảnh đang được chọn trên Canvas (Ví dụ người dùng vừa upload)
        const activeObj = this.canvas.getActiveObject();
        if (activeObj && activeObj.type === 'image') {
            generationSourceBase64 = activeObj.toDataURL({ format: 'png' }).split(',')[1];
            generationReferenceImage = activeObj.toDataURL({ format: 'png' });
        } 
        // Ưu tiên 2: Sử dụng ảnh baseImage từ Visual Mode nếu có
        else if (this.baseImage) {
            generationSourceBase64 = await this._urlToBase64(this.baseImage);
        }
        // Ưu tiên 3: Nếu chỉ có đúng 1 ảnh trên Canvas, tự động lấy ảnh đó
        else {
            const imagesOnCanvas = this.canvas.getObjects('image');
            if (imagesOnCanvas.length === 1) {
                generationSourceBase64 = imagesOnCanvas[0].toDataURL({ format: 'png' }).split(',')[1];
                generationReferenceImage = imagesOnCanvas[0].toDataURL({ format: 'png' });
            }
        }

        if (!generationSourceBase64) {
            app.showToast('Vui lòng CHỌN 1 ảnh trên Canvas, hoặc bấm [Lấy từ Tab Mặc Đồ] trước.', 'warning');
            return;
        }

        this.showLoading('Đang vẽ 4 góc cùng lúc (Khoảng 20s)...');
        
        try {
            const sourceImage = { data: generationSourceBase64, mimeType: 'image/png' };

            // Fetch prompt overrides
            let promptOverrides = {};
            try {
                const saved = localStorage.getItem('nanobana_prompt_overrides');
                if (saved) promptOverrides = JSON.parse(saved);
            } catch(e) {}

            const apiKey = localStorage.getItem('nanobana_api_key') || '';
            const modelId = document.getElementById('canvas-model-select')?.value || 'pro';

            const perspectives = ['a_front', 'a_back', 'a_side_right', 'a_side_left'];
            const startX = 800; // Place right next to where the base image usually is
            
            this.isCancelled = false;
            if (document.getElementById('canvas-btn-generate')) document.getElementById('canvas-btn-generate').style.display = 'none';
            if (document.getElementById('canvas-btn-cancel')) document.getElementById('canvas-btn-cancel').style.display = 'flex';

            // Execute SEQUENTIALLY to avoid Vertex AI RPM rate limiting
            // (4 parallel requests overwhelm the per-minute limit)
            let resultIndex = startIndex;
            for (let i = startIndex; i < perspectives.length; i++) {
                if (this.isCancelled) break;
                
                const perspective = perspectives[i];
                
                // Update loading text
                this.showLoading(`Đang vẽ góc ${i + 1}/4: ${perspective.replace('a_', '').replace('_', ' ')}...`);
                
                try {
                    const abortController = new AbortController();
                    if (!this.abortControllers) this.abortControllers = [];
                    this.abortControllers.push(abortController);
                    
                    const flatLighting = document.getElementById('canvas-flat-lighting')?.checked !== false;
                    const response = await fetch('/api/workflow/canvas/pose', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': apiKey,
                        },
                        body: JSON.stringify({ 
                            sourceImage, 
                            perspective, 
                            promptOverrides,
                            equippedState: this.equippedState,
                            modelId,
                            flatLighting
                        }),
                        signal: abortController.signal
                    });
                    
                    const result = await response.json();
                    
                    if (result.success && result.imageBase64) {
                        try {
                            this.showLoading(`Đang xóa nền tự động cho: ${perspective} (${i + 1}/4)...`);
                            const noBgResult = await this._removeBackgroundAPI(result.imageBase64, result.mimeType);
                            const finalBase64 = noBgResult ? noBgResult.imageBase64 : result.imageBase64;
                            const finalMime = noBgResult ? noBgResult.mimeType : result.mimeType;

                            const dataUrl = `data:${finalMime};base64,${finalBase64}`;
                            this.addImageToCanvas(dataUrl, {
                                scale: 1,
                                left: startX + (resultIndex * 600),
                                top: 100
                            });
                        } catch (err) {
                            console.error(`[Multi-Pose RMBG] Auto removing bg failed for ${perspective}`, err);
                            const dataUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
                            this.addImageToCanvas(dataUrl, {
                                scale: 1,
                                left: startX + (resultIndex * 600),
                                top: 100
                            });
                        }
                        app.showToast(`✅ Hoàn tất góc ${i + 1}/4: ${perspective}`, 'success');
                    } else {
                        throw new Error(result.error || result.text || 'Lỗi server trả về');
                    }
                } catch (err) {
                    if (err.name === 'AbortError') break;
                    console.error(`[Canvas] Lỗi góc ${perspective}:`, err);
                    
                    this.lastAction.startIndex = i; // Save progress for retry
                    this.showErrorOverlay(`Lỗi tạo góc ${perspective}: ${err.message}`);
                    return; // Stop on error entirely
                }
                
                resultIndex++;
                
                // Wait 3 seconds between requests to avoid RPM rate limiting
                if (i < perspectives.length - 1 && !this.isCancelled) {
                    await new Promise(r => setTimeout(r, 3000));
                }
            }

            if (!this.isCancelled) {
                app.showToast('Vẽ 4 góc hoàn tất!', 'success');
                this.hideLoading();
            }

        } catch(err) {
            console.error('[Multi-Pose]', err);
            this.showErrorOverlay('Lỗi hệ thống: ' + err.message);
        } finally {
            if (document.getElementById('canvas-btn-generate')) document.getElementById('canvas-btn-generate').style.display = 'flex';
            if (document.getElementById('canvas-btn-cancel')) document.getElementById('canvas-btn-cancel').style.display = 'none';
        }
    }

    /**
     * Executes generation for a single requested perspective
     */
    async generateSinglePose(perspective) {
        this.lastAction = { type: 'single', perspective };
        let generationSourceBase64 = null;

        const activeObj = this.canvas.getActiveObject();
        if (activeObj && activeObj.type === 'image') {
            generationSourceBase64 = activeObj.toDataURL({ format: 'png' }).split(',')[1];
        } else if (this.baseImage) {
            generationSourceBase64 = await this._urlToBase64(this.baseImage);
        } else {
            const imagesOnCanvas = this.canvas.getObjects('image');
            if (imagesOnCanvas.length === 1) {
                generationSourceBase64 = imagesOnCanvas[0].toDataURL({ format: 'png' }).split(',')[1];
            }
        }

        if (!generationSourceBase64) {
            app.showToast('Vui lòng CHỌN 1 ảnh trên Canvas, hoặc bấm [Lấy từ Tab Mặc Đồ] trước.', 'warning');
            return;
        }

        this.showLoading(`Đang vẽ góc: ${perspective}...`);
        
        try {
            const sourceImage = { data: generationSourceBase64, mimeType: 'image/png' };
            let promptOverrides = {};
            try {
                const saved = localStorage.getItem('nanobana_prompt_overrides');
                if (saved) promptOverrides = JSON.parse(saved);
            } catch(e) {}

            const apiKey = localStorage.getItem('nanobana_api_key') || '';
            const modelId = document.getElementById('canvas-model-select')?.value || 'pro';
            const startX = 800;
            
            this.isCancelled = false;
            if (document.getElementById('canvas-btn-generate')) document.getElementById('canvas-btn-generate').style.display = 'none';
            if (document.getElementById('canvas-btn-cancel')) document.getElementById('canvas-btn-cancel').style.display = 'flex';

            this.currentAbortController = new AbortController();
            
            const flatLighting = document.getElementById('canvas-flat-lighting')?.checked !== false;
            const response = await fetch('/api/workflow/canvas/pose', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey,
                },
                body: JSON.stringify({ 
                    sourceImage, 
                    perspective, 
                    promptOverrides,
                    equippedState: this.equippedState,
                    modelId,
                    flatLighting
                }),
                signal: this.currentAbortController.signal
            });
            
            const result = await response.json();

            if (result.success && result.imageBase64) {
                // Layout adjustment depending on where to place it
                let offsetX = 0;
                switch (perspective) {
                    case 'a_front': offsetX = 0; break;
                    case 'a_back': offsetX = 600; break;
                    case 'a_side_right': offsetX = 1200; break;
                    case 'a_side_left': offsetX = 1800; break;
                }

                try {
                    this.showLoading(`Đang xóa nền tự động cho góc mới...`);
                    const noBgResult = await this._removeBackgroundAPI(result.imageBase64, result.mimeType);
                    const finalBase64 = noBgResult ? noBgResult.imageBase64 : result.imageBase64;
                    const finalMime = noBgResult ? noBgResult.mimeType : result.mimeType;

                    const dataUrl = `data:${finalMime};base64,${finalBase64}`;
                    this.addImageToCanvas(dataUrl, { scale: 1, left: startX + offsetX, top: 100 });
                } catch (err) {
                    const dataUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
                    this.addImageToCanvas(dataUrl, { scale: 1, left: startX + offsetX, top: 100 });
                }
                app.showToast(`Hoàn tất góc ${perspective}!`, 'success');
                this.hideLoading(); // Hiding loading only on complete success
            } else {
                throw new Error(result.error || result.text || 'Lỗi server trả về');
            }
        } catch (netErr) {
            if (netErr.name === 'AbortError') {
                app.showToast(`Đã dừng tải góc ${perspective}`, 'warning');
                this.hideLoading();
            } else {
                console.error(`Network error for ${perspective}`, netErr);
                this.showErrorOverlay(netErr.message);
            }
        } finally {
            this.currentAbortController = null;
            if (document.getElementById('canvas-btn-generate')) document.getElementById('canvas-btn-generate').style.display = 'flex';
            if (document.getElementById('canvas-btn-cancel')) document.getElementById('canvas-btn-cancel').style.display = 'none';
        }
    }

    /**
     * Extracts specific clothing element from base image
     */
    async extractElement() {
        let extractionSourceBase64 = null;

        const activeObj = this.canvas.getActiveObject();
        if (activeObj && activeObj.type === 'image') {
            extractionSourceBase64 = activeObj.toDataURL({ format: 'png' }).split(',')[1];
        } else if (this.baseImage) {
            extractionSourceBase64 = await this._urlToBase64(this.baseImage);
        } else {
            const imagesOnCanvas = this.canvas.getObjects('image');
            if (imagesOnCanvas.length === 1) {
                extractionSourceBase64 = imagesOnCanvas[0].toDataURL({ format: 'png' }).split(',')[1];
            }
        }

        if (!extractionSourceBase64) {
            app.showToast('Vui lòng chọn 1 ảnh trên Canvas để bóc tách.', 'warning');
            return;
        }

        const slot = document.getElementById('extract-slot-select').value;
        const slotName = document.getElementById('extract-slot-select').options[document.getElementById('extract-slot-select').selectedIndex].text;
        
        const perspective = document.getElementById('extract-angle-select') ? document.getElementById('extract-angle-select').value : 'default';

        this.showLoading(`Đang AI cắt tách chi tiết: ${slotName}...`);

        try {
            const sourceImage = { data: extractionSourceBase64, mimeType: 'image/png' };
            const apiKey = localStorage.getItem('nanobana_api_key') || '';

            const response = await fetch('/api/workflow/canvas/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey,
                },
                body: JSON.stringify({ sourceImage, slot, perspective }),
            });

            const result = await response.json();
            
            if (result.success && result.imageBase64) {
                // Immediately send for background removal
                this.showLoading(`Đang xóa phông cho ${slotName}...`);
                const noBgResult = await this._removeBackgroundAPI(result.imageBase64, result.mimeType);
                
                if (noBgResult) {
                    const dataUrl = `data:${noBgResult.mimeType};base64,${noBgResult.imageBase64}`;
                    this.addImageToCanvas(dataUrl, { scale: 0.8 });
                    app.showToast(`Bóc tách ${slotName} hoàn tất!`, 'success');
                } else {
                    // Fallback to original if bg removal fails
                    const dataUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
                    this.addImageToCanvas(dataUrl, { scale: 0.8 });
                    app.showToast('Bóc tách thành công nhưng xóa phông thất bại.', 'warning');
                }
            } else {
                throw new Error(result.error);
            }
        } catch(err) {
            console.error('[Extract]', err);
            app.showToast('Lỗi bóc tách: ' + err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Remove background of actively selected item on canvas
     */
    async removeBgOfSelected() {
        const activeObj = this.canvas.getActiveObject();
        if (!activeObj || activeObj.type !== 'image') {
            app.showToast('Vui lòng click chọn 1 tấm ảnh trên Canvas để xóa phông.', 'warning');
            return;
        }

        this.showLoading('Đang gọi AI RMBG (Offline) cắt nền siêu chuẩn...');
        
        try {
            // Convert current object to data URL
            const dataUrl = activeObj.toDataURL({ format: 'png' });
            
            // Extract base64 and mime
            const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (!matches) throw new Error('DataURL format error');
            const mimeType = matches[1];
            const base64 = matches[2];

            const result = await this._removeBackgroundAPI(base64, mimeType);
            
            if (result) {
                const newObjUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
                
                // Replace old object with new one without resetting position/scale
                fabric.Image.fromURL(newObjUrl, (img) => {
                    img.set({
                        left: activeObj.left,
                        top: activeObj.top,
                        scaleX: activeObj.scaleX,
                        scaleY: activeObj.scaleY,
                        angle: activeObj.angle,
                        cornerColor: '#7c6aff', 
                        borderColor: '#7c6aff', 
                        transparentCorners: false
                    });
                    this.canvas.add(img);
                    this.canvas.remove(activeObj);
                    this.canvas.setActiveObject(img);
                    this.canvas.renderAll();
                    app.showToast('Xóa phông nền thành công!', 'success');
                });
            } else {
                throw new Error("API call failed");
            }
        } catch(err) {
            console.error('[RMBG]', err);
            app.showToast('Lỗi khi cắt phông nền: ' + err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Calls the node.js endpoint for offline background removal
     */
    async _removeBackgroundAPI(base64, mimeType) {
        // Convert to FormData for binary upload
        const byteCharacters = atob(base64);
        const byteArrays = [];
        for (let i = 0; i < byteCharacters.length; i++) {
            byteArrays.push(byteCharacters.charCodeAt(i));
        }
        const byteArray = new Uint8Array(byteArrays);
        const blob = new Blob([byteArray], {type: mimeType});
        
        const fd = new FormData();
        fd.append('image', blob, 'image.png');

        const response = await fetch('/api/utils/remove-bg', {
            method: 'POST',
            body: fd
        });

        const resObj = await response.json();
        if (resObj.success) {
            return {
                imageBase64: resObj.imageBase64,
                mimeType: resObj.mimeType
            };
        }
        return null;
    }

    /**
     * Export the full canvas as a PNG
     */
    exportCanvas() {
        if (!this.canvas) return;
        
        // De-select everything to hide the transform borders
        this.canvas.discardActiveObject();
        this.canvas.renderAll();

        const scale = this.canvas.getZoom();
        
        const dataUrl = this.canvas.toDataURL({
            format: 'png',
            quality: 1,
            multiplier: 1 / scale // Upscale back to the original size defined in inputs
        });

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `character_sheet_${this.canvas.originalWidth}x${this.canvas.originalHeight}_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        app.showToast('Đã lưu Character Sheet thành công!', 'success');
    }

    _urlToBase64(url) {
        return new Promise((resolve, reject) => {
            fetch(url)
                .then(response => response.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const b64 = reader.result.split(',')[1];
                        resolve(b64);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                })
                .catch(reject);
        });
    }
}

// Global instance
window.canvasMode = new CanvasMode();
