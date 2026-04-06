// =============================================================================
// 3K FreeFire Studio — Custom LiteGraph Node Types
// =============================================================================
// Registers FreeFire-specialized nodes with the LiteGraph engine
// Node types: ImageInput, FaceReference, OutfitSelector, PoseSelector,
//             StyleSelector, OutputNode, CustomPrompt
// =============================================================================

(function (global) {
    'use strict';

    // Ensure LiteGraph is available
    if (typeof LiteGraph === 'undefined') {
        console.error('[FF Nodes] LiteGraph not loaded!');
        return;
    }

    // ─── Color Palette ──────────────────────────────────────────────────────
    const COLORS = {
        imageInput:    { bg: '#1a3a1a', border: '#4CAF50', title: '#66BB6A' },
        faceRef:       { bg: '#3a1a3a', border: '#9C27B0', title: '#CE93D8' },
        outfit:        { bg: '#1a2a3a', border: '#2196F3', title: '#64B5F6' },
        pose:          { bg: '#3a2a1a', border: '#FF9800', title: '#FFB74D' },
        style:         { bg: '#3a1a2a', border: '#E91E63', title: '#F48FB1' },
        output:        { bg: '#2a2a1a', border: '#FFC107', title: '#FFD54F' },
        custom:        { bg: '#1a2a2a', border: '#00BCD4', title: '#4DD0E1' },
    };

    const IMAGE_TYPE = 'IMAGE';
    const FACE_TYPE = 'FACE_DATA';

    // ═══════════════════════════════════════════════════════════════════════
    // IMAGE INPUT NODE
    // ═══════════════════════════════════════════════════════════════════════

    function ImageInputNode() {
        this.addOutput('image', IMAGE_TYPE);
        this.properties = {
            imagePath: '',
            imageData: null,
            fileName: '',
            aspectRatio: 'original',
        };
        this.size = [220, 180];
        this.title = '🖼️ Ảnh Đầu Vào';
        
        // Internal state
        this._thumbnail = null;
        this._hasImage = false;
    }

    ImageInputNode.title = '🖼️ Ảnh Đầu Vào';
    ImageInputNode.desc = 'Upload ảnh nhân vật FreeFire gốc';

    ImageInputNode.prototype.onAdded = function () {
        this.addWidget('combo', 'Tỉ lệ ảnh', 'original', (v) => {
            this.properties.aspectRatio = v;
        }, {
            values: ['original', '1:1', '3:2', '4:3', '16:9', '9:16', '2:3']
        });
    };

    ImageInputNode.prototype.onExecute = function () {
        if (this.properties.imageData) {
            this.setOutputData(0, {
                type: 'image',
                data: this.properties.imageData,
                mimeType: 'image/png',
                aspectRatio: this.properties.aspectRatio,
            });
        }
    };

    ImageInputNode.prototype.onDrawForeground = function (ctx) {
        if (this._thumbnail) {
            const margin = 10;
            const imgW = this.size[0] - margin * 2;
            const imgH = this.size[1] - 50;
            ctx.drawImage(this._thumbnail, margin, 35, imgW, imgH);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Click đôi để upload', this.size[0] / 2, this.size[1] / 2 + 10);
            ctx.fillText('hoặc kéo thả ảnh vào', this.size[0] / 2, this.size[1] / 2 + 26);
        }
    };

    ImageInputNode.prototype.onDblClick = function () {
        const url = prompt("Nhập đường dẫn hình ảnh (URL) - Hoặc để trống / Hủy để tải file từ thiết bị:");
        if (url) {
            if (window.app && window.API) {
                window.app.showToast("Đang tải ảnh từ đường dẫn...", "info");
                window.API.fetchImageUrl(url).then(res => {
                    if (res.success && res.base64) {
                        this.properties.imageData = res.base64;
                        this.properties.fileName = "image-from-url.jpg";
                        this._hasImage = true;
                        const img = new Image();
                        img.onload = () => {
                            this._thumbnail = img;
                            this.setDirtyCanvas(true);
                        };
                        img.src = res.dataUrl;
                    } else {
                        window.app.showToast("Tải ảnh thất bại.", "error");
                    }
                }).catch(e => window.app.showToast("Lỗi proxy tải ảnh: " + e.message, "error"));
            }
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            this.properties.fileName = file.name;

            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64 = ev.target.result.split(',')[1];
                this.properties.imageData = base64;
                this._hasImage = true;

                // Create thumbnail
                const img = new Image();
                img.onload = () => {
                    this._thumbnail = img;
                    this.setDirtyCanvas(true);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };

    ImageInputNode.prototype.onDropFile = function (file) {
        if (!file.type.startsWith('image/')) return;
        this.properties.fileName = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => {
            this.properties.imageData = ev.target.result.split(',')[1];
            this._hasImage = true;
            const img = new Image();
            img.onload = () => {
                this._thumbnail = img;
                this.setDirtyCanvas(true);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    };

    LiteGraph.registerNodeType('ff/image_input', ImageInputNode);
    ImageInputNode.bgcolor = COLORS.imageInput.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // FACE REFERENCE NODE
    // ═══════════════════════════════════════════════════════════════════════

    function FaceReferenceNode() {
        this.addInput('image_front', IMAGE_TYPE);
        this.addInput('image_side', IMAGE_TYPE);
        this.addInput('image_back', IMAGE_TYPE);
        this.addOutput('face_data', FACE_TYPE);
        this.addOutput('image', IMAGE_TYPE); // Pass-through (from front)
        this.properties = {
            faceImages: [],       // Additional face reference images (via double-click)
            preserveStrength: 1.0, // How strongly to preserve (0-1)
            multiAngle: true,     // Default ON now with 3 slots
        };
        this.size = [240, 180];
        this.title = '🎭 Khuôn Mặt Tham Chiếu';

        this._faceCount = 0;
        this._thumbnails = {};
    }

    FaceReferenceNode.title = '🎭 Khuôn Mặt Tham Chiếu';
    FaceReferenceNode.desc = 'Lock khuôn mặt — 3 góc: trước/ngang/sau';

    FaceReferenceNode.prototype.onExecute = function () {
        const frontImage = this.getInputData(0);
        const sideImage = this.getInputData(1);
        const backImage = this.getInputData(2);
        
        const faceData = {
            type: 'face_data',
            referenceImages: [...this.properties.faceImages],
            preserveStrength: this.properties.preserveStrength,
            multiAngle: this.properties.multiAngle,
            angles: {},
        };

        // Add images from the 3 angle input slots
        if (frontImage && frontImage.data) {
            faceData.referenceImages.unshift({
                data: frontImage.data,
                mimeType: frontImage.mimeType || 'image/png',
                angle: 'front',
            });
            faceData.angles.front = true;
        }
        if (sideImage && sideImage.data) {
            faceData.referenceImages.push({
                data: sideImage.data,
                mimeType: sideImage.mimeType || 'image/png',
                angle: 'side',
            });
            faceData.angles.side = true;
        }
        if (backImage && backImage.data) {
            faceData.referenceImages.push({
                data: backImage.data,
                mimeType: backImage.mimeType || 'image/png',
                angle: 'back',
            });
            faceData.angles.back = true;
        }

        this._faceCount = faceData.referenceImages.length;
        this.setOutputData(0, faceData);
        this.setOutputData(1, frontImage || sideImage); // Pass through best available
    };

    FaceReferenceNode.prototype.onDrawForeground = function (ctx) {
        // Show angle status
        const y0 = 40;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        
        const angles = [
            { key: 'front', label: '📷 Trước', port: 0 },
            { key: 'side', label: '📷 Ngang', port: 1 },
            { key: 'back', label: '📷 Sau', port: 2 },
        ];

        angles.forEach((a, i) => {
            const hasInput = this.getInputData(a.port);
            ctx.fillStyle = hasInput ? '#CE93D8' : 'rgba(255,255,255,0.2)';
            ctx.fillText(
                `${a.label}: ${hasInput ? '✓' : '-'}`,
                10, y0 + i * 16
            );
        });

        // Additional uploaded images count
        if (this.properties.faceImages.length > 0) {
            ctx.fillStyle = '#CE93D8';
            ctx.textAlign = 'center';
            ctx.fillText(
                `+${this.properties.faceImages.length} ảnh upload`,
                this.size[0] / 2, this.size[1] - 12
            );
        }

        // Total count
        ctx.fillStyle = this._faceCount > 0 ? '#CE93D8' : 'rgba(255,255,255,0.3)';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(
            `${this._faceCount} ảnh`,
            this.size[0] - 10, y0
        );
    };

    FaceReferenceNode.prototype.onDblClick = function () {
        const url = prompt("Nhập đường dẫn hình ảnh tham chiếu (URL) - Hoặc để trống / Hủy để tải file từ máy:");
        if (url) {
            if (window.app && window.API) {
                window.app.showToast("Đang tải ảnh từ đường dẫn...", "info");
                window.API.fetchImageUrl(url).then(res => {
                    if (res.success && res.base64) {
                        this.properties.faceImages.push({
                            data: res.base64,
                            mimeType: res.mimeType,
                        });
                        this._faceCount = this.properties.faceImages.length;
                        this.setDirtyCanvas(true);
                    } else {
                        window.app.showToast("Tải ảnh thất bại.", "error");
                    }
                }).catch(e => window.app.showToast("Lỗi proxy tải ảnh: " + e.message, "error"));
            }
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = (e) => {
            for (const file of e.target.files) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.properties.faceImages.push({
                        data: ev.target.result.split(',')[1],
                        mimeType: file.type,
                    });
                    this._faceCount = this.properties.faceImages.length;
                    this.setDirtyCanvas(true);
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    };

    // Widget for preserve strength
    FaceReferenceNode.prototype.onAdded = function () {
        this.addWidget('slider', 'Độ giữ mặt', 1.0, (v) => {
            this.properties.preserveStrength = v;
        }, { min: 0, max: 1, step: 0.1 });
        
        this.addWidget('toggle', 'Nhiều góc mặt', false, (v) => {
            this.properties.multiAngle = v;
        });
    };

    LiteGraph.registerNodeType('ff/face_reference', FaceReferenceNode);
    FaceReferenceNode.bgcolor = COLORS.faceRef.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // OUTFIT SELECTOR NODE
    // ═══════════════════════════════════════════════════════════════════════

    function OutfitSelectorNode() {
        this.addInput('image', IMAGE_TYPE);
        this.addInput('face_data', FACE_TYPE);
        this.addOutput('image', IMAGE_TYPE);
        this.properties = {
            outfitDescription: '',
            preset: 'custom',
            preserveFace: true,
        };
        this.size = [260, 160];
        this.title = '👗 Trang Phục';
    }

    OutfitSelectorNode.title = '👗 Trang Phục';
    OutfitSelectorNode.desc = 'Thay đổi trang phục nhân vật';

    OutfitSelectorNode.prototype.onAdded = function () {
        this.addWidget('text', 'Mô tả outfit', '', (v) => {
            this.properties.outfitDescription = v;
        });
        
        this.addWidget('combo', 'Preset', 'custom', (v) => {
            this.properties.preset = v;
            if (v !== 'custom' && global.FF_OUTFIT_PRESETS && global.FF_OUTFIT_PRESETS[v]) {
                this.properties.outfitDescription = global.FF_OUTFIT_PRESETS[v].description;
            }
        }, {
            values: ['custom', 'casual_sport', 'military', 'futuristic', 'traditional', 'bikini_beach', 'formal_suit']
        });

        this.addWidget('toggle', 'Giữ mặt', true, (v) => {
            this.properties.preserveFace = v;
        });
    };

    OutfitSelectorNode.prototype.onExecute = function () {
        const inputImage = this.getInputData(0);
        const faceData = this.getInputData(1);

        this.setOutputData(0, {
            type: 'image',
            sourceImage: inputImage,
            faceData: faceData,
            nodeType: 'outfit',
            config: {
                outfit: this.properties.outfitDescription,
                preserveFace: this.properties.preserveFace,
            },
        });
    };

    OutfitSelectorNode.prototype.onDrawForeground = function (ctx) {
        const desc = this.properties.outfitDescription;
        ctx.fillStyle = desc ? '#64B5F6' : 'rgba(255,255,255,0.3)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const text = desc ? (desc.length > 30 ? desc.substring(0, 30) + '...' : desc) : 'Nhập mô tả trang phục';
        ctx.fillText(text, this.size[0] / 2, this.size[1] - 15);
    };

    LiteGraph.registerNodeType('ff/outfit_selector', OutfitSelectorNode);
    OutfitSelectorNode.bgcolor = COLORS.outfit.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // POSE SELECTOR NODE
    // ═══════════════════════════════════════════════════════════════════════

    function PoseSelectorNode() {
        this.addInput('image', IMAGE_TYPE);
        this.addInput('face_data', FACE_TYPE);
        this.addInput('pose_image', IMAGE_TYPE);  // v2.2: Reference pose image
        this.addOutput('image', IMAGE_TYPE);
        this.properties = {
            poseDescription: '',
            preset: 'custom',
            preserveFace: true,
            poseImageData: null,
        };
        this.size = [260, 200];
        this.title = '💃 Pose / Tư Thế';
        this._poseThumb = null;
    }

    PoseSelectorNode.title = '💃 Pose / Tư Thế';
    PoseSelectorNode.desc = 'Thay đổi tư thế — hỗ trợ ảnh pose tham chiếu';

    PoseSelectorNode.prototype.onAdded = function () {
        this.addWidget('text', 'Mô tả pose', '', (v) => {
            this.properties.poseDescription = v;
        });
        
        this.addWidget('combo', 'Preset', 'custom', (v) => {
            this.properties.preset = v;
            if (v !== 'custom') {
                const posePresets = {
                    standing_idle: 'Standing idle pose, relaxed stance, weight on one leg, arms naturally at sides',
                    victory: 'Victory celebration pose, one fist raised in the air, confident expression, slight lean back',
                    action_shooting: 'Dynamic shooting pose, holding weapon with both hands aimed forward, slight crouch',
                    running: 'Running pose mid-stride, arms pumping, dynamic forward motion',
                    sitting: 'Sitting pose, legs crossed casually, one hand resting on knee',
                    t_pose: 'T-pose with arms extended horizontally, standing straight, facing camera',
                    crouching: 'Tactical crouch position, one knee down, ready stance',
                    jumping: 'Mid-air jump pose, legs tucked, arms spread for balance',
                    dancing: 'Dynamic dance pose, one leg lifted, arms in expressive position',
                    kneeling: 'Kneeling on one knee, looking forward, hands at sides',
                };
                this.properties.poseDescription = posePresets[v] || v;
            }
        }, {
            values: ['custom', 'standing_idle', 'victory', 'action_shooting', 'running', 'sitting', 't_pose', 'crouching', 'jumping', 'dancing', 'kneeling']
        });

        this.addWidget('toggle', 'Giữ mặt', true, (v) => {
            this.properties.preserveFace = v;
        });
    };

    PoseSelectorNode.prototype.onExecute = function () {
        const inputImage = this.getInputData(0);
        const faceData = this.getInputData(1);
        const poseRefImage = this.getInputData(2);  // v2.2: pose reference image

        this.setOutputData(0, {
            type: 'image',
            sourceImage: inputImage,
            faceData: faceData,
            nodeType: 'pose',
            config: {
                pose: this.properties.poseDescription,
                preserveFace: this.properties.preserveFace,
                poseReferenceImage: poseRefImage || null,
            },
        });
    };

    PoseSelectorNode.prototype.onDblClick = function () {
        const url = prompt("Nhập đường dẫn hình ảnh tư thế mẫu (URL) - Hoặc để trống / Hủy để tải file từ máy:");
        if (url) {
            if (window.app && window.API) {
                window.app.showToast("Đang tải ảnh tư thế từ đường dẫn...", "info");
                window.API.fetchImageUrl(url).then(res => {
                    if (res.success && res.base64) {
                        this.properties.poseImageData = res.base64;
                        const img = new Image();
                        img.onload = () => {
                            this._poseThumb = img;
                            this.setDirtyCanvas(true);
                        };
                        img.src = res.dataUrl;
                    } else {
                        window.app.showToast("Tải ảnh thất bại.", "error");
                    }
                }).catch(e => window.app.showToast("Lỗi proxy tải ảnh: " + e.message, "error"));
            }
            return;
        }

        // Allow uploading a pose reference image directly
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.properties.poseImageData = ev.target.result.split(',')[1];
                const img = new Image();
                img.onload = () => {
                    this._poseThumb = img;
                    this.setDirtyCanvas(true);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };

    PoseSelectorNode.prototype.onDrawForeground = function (ctx) {
        // Show pose thumbnail if uploaded
        if (this._poseThumb) {
            const thumbSize = 50;
            ctx.drawImage(this._poseThumb, this.size[0] - thumbSize - 8, 35, thumbSize, thumbSize);
            ctx.fillStyle = '#FFB74D';
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Ảnh pose ref', this.size[0] - 8, 35 + thumbSize + 12);
        }
        // Show pose description
        const desc = this.properties.poseDescription;
        ctx.fillStyle = desc ? '#FFB74D' : 'rgba(255,255,255,0.3)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const text = desc ? (desc.length > 30 ? desc.substring(0, 30) + '...' : desc) : 'Chọn tư thế hoặc kéo ảnh pose vào';
        ctx.fillText(text, this.size[0] / 2, this.size[1] - 15);
    };

    LiteGraph.registerNodeType('ff/pose_selector', PoseSelectorNode);
    PoseSelectorNode.bgcolor = COLORS.pose.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // STYLE SELECTOR NODE
    // ═══════════════════════════════════════════════════════════════════════

    function StyleSelectorNode() {
        this.addInput('image', IMAGE_TYPE);
        this.addInput('face_data', FACE_TYPE);
        this.addOutput('image', IMAGE_TYPE);
        this.properties = {
            style: '3d_render',
            customInstructions: '',
            preserveFace: true,
        };
        this.size = [240, 130];
        this.title = '🎨 Phong Cách';
    }

    StyleSelectorNode.title = '🎨 Phong Cách';
    StyleSelectorNode.desc = 'Chọn phong cách: 3D, Realistic, Anime...';

    StyleSelectorNode.prototype.onAdded = function () {
        this.addWidget('combo', 'Style', '3d_render', (v) => {
            this.properties.style = v;
        }, {
            values: ['3d_render', 'realistic', 'semi_realistic', 'anime']
        });

        this.addWidget('text', 'Tùy chỉnh thêm', '', (v) => {
            this.properties.customInstructions = v;
        });
        
        this.addWidget('toggle', 'Giữ mặt', true, (v) => {
            this.properties.preserveFace = v;
        });
    };

    StyleSelectorNode.prototype.onExecute = function () {
        const inputImage = this.getInputData(0);
        const faceData = this.getInputData(1);

        this.setOutputData(0, {
            type: 'image',
            sourceImage: inputImage,
            faceData: faceData,
            nodeType: 'style',
            config: {
                style: this.properties.style,
                customPrompt: this.properties.customInstructions,
                preserveFace: this.properties.preserveFace,
            },
        });
    };

    StyleSelectorNode.prototype.onDrawForeground = function (ctx) {
        const styleNames = {
            '3d_render': '🎮 3D Game Render',
            'realistic': '📷 Ảnh Thực Tế',
            'semi_realistic': '🎬 Bán Thực Tế',
            'anime': '🎌 Anime',
        };
        ctx.fillStyle = '#F48FB1';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(styleNames[this.properties.style] || this.properties.style, this.size[0] / 2, this.size[1] - 12);
    };

    LiteGraph.registerNodeType('ff/style_selector', StyleSelectorNode);
    StyleSelectorNode.bgcolor = COLORS.style.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // OUTPUT NODE
    // ═══════════════════════════════════════════════════════════════════════

    function OutputNode() {
        this.addInput('image', IMAGE_TYPE);
        this.properties = {
            aspectRatio: '1:1',
            model: 'pro',
            outputFormat: 'png',
            multiView: false,
        };
        this.size = [200, 150];
        this.title = '📤 Kết Quả';
        
        this._resultImage = null;
        this._status = 'waiting';
    }

    OutputNode.title = '📤 Kết Quả';
    OutputNode.desc = 'Preview kết quả và xuất ảnh';

    OutputNode.prototype.onAdded = function () {
        this.addWidget('combo', 'Tỉ lệ', '1:1', (v) => {
            this.properties.aspectRatio = v;
        }, {
            values: ['1:1', '3:2', '4:3', '16:9', '9:16', '2:3']
        });

        this.addWidget('combo', 'Model', 'pro', (v) => {
            this.properties.model = v;
        }, {
            values: ['pro', 'flash', 'flash25']
        });

        this.addWidget('toggle', 'Multi-View (3 góc)', false, (v) => {
            this.properties.multiView = v;
        });
    };

    OutputNode.prototype.onExecute = function () {
        const inputData = this.getInputData(0);
        if (inputData) {
            this._status = 'ready';
        }
    };

    OutputNode.prototype.onDrawForeground = function (ctx) {
        if (this._resultImage) {
            const margin = 10;
            const imgW = this.size[0] - margin * 2;
            const imgH = this.size[1] - 55;
            ctx.drawImage(this._resultImage, margin, 35, imgW, imgH);
        } else {
            ctx.fillStyle = this._status === 'ready' ? '#FFD54F' : 'rgba(255,255,255,0.2)';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            const text = this._status === 'ready' ? '✓ Sẵn sàng' : 'Đang chờ...';
            ctx.fillText(text, this.size[0] / 2, this.size[1] / 2 + 10);
        }
    };

    LiteGraph.registerNodeType('ff/output', OutputNode);
    OutputNode.bgcolor = COLORS.output.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM PROMPT NODE
    // ═══════════════════════════════════════════════════════════════════════

    function CustomPromptNode() {
        this.addInput('image', IMAGE_TYPE);
        this.addInput('face_data', FACE_TYPE);
        this.addOutput('image', IMAGE_TYPE);
        this.properties = {
            prompt: '',
            preserveFace: true,
            denoisingStrength: 0.5,
        };
        this.size = [280, 140];
        this.title = '✏️ Tùy Chỉnh Thêm';
    }

    CustomPromptNode.title = '✏️ Tùy Chỉnh Thêm';
    CustomPromptNode.desc = 'Nhập prompt tùy chỉnh cho nhân vật';

    CustomPromptNode.prototype.onAdded = function () {
        this.addWidget('text', 'Prompt', '', (v) => {
            this.properties.prompt = v;
        });
        
        this.addWidget('slider', 'Cường độ', 0.5, (v) => {
            this.properties.denoisingStrength = v;
        }, { min: 0, max: 1, step: 0.1 });

        this.addWidget('toggle', 'Giữ mặt', true, (v) => {
            this.properties.preserveFace = v;
        });
    };

    CustomPromptNode.prototype.onExecute = function () {
        const inputImage = this.getInputData(0);
        const faceData = this.getInputData(1);

        this.setOutputData(0, {
            type: 'image',
            sourceImage: inputImage,
            faceData: faceData,
            nodeType: 'custom',
            config: {
                customPrompt: this.properties.prompt,
                denoisingStrength: this.properties.denoisingStrength,
                preserveFace: this.properties.preserveFace,
            },
        });
    };

    LiteGraph.registerNodeType('ff/custom_prompt', CustomPromptNode);
    CustomPromptNode.bgcolor = COLORS.custom.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // BODY ANATOMY MAPPER NODE (Modular Outfit System)
    // ═══════════════════════════════════════════════════════════════════════

    const ANATOMY_TYPE = 'ANATOMY_DATA';
    COLORS.anatomy = { bg: '#1a2a2a', border: '#26A69A', title: '#80CBC4' };
    COLORS.component = { bg: '#1a2833', border: '#5C6BC0', title: '#9FA8DA' };

    function BodyAnatomyMapperNode() {
        this.addInput('image', IMAGE_TYPE);
        this.addOutput('anatomy_data', ANATOMY_TYPE);
        this.addOutput('image', IMAGE_TYPE);
        this.properties = { bodyType: 'standard', poseSource: 'from_input_image' };
        this.size = [220, 120];
        this.title = '🦴 Body Anatomy';
    }

    BodyAnatomyMapperNode.title = '🦴 Body Anatomy';
    BodyAnatomyMapperNode.desc = 'Map body proportions for outfit fitting';

    BodyAnatomyMapperNode.prototype.onAdded = function () {
        this.addWidget('combo', 'Body Type', 'standard', (v) => {
            this.properties.bodyType = v;
        }, { values: ['standard', 'athletic', 'slim', 'heavy'] });
        this.addWidget('combo', 'Pose Src', 'from_input_image', (v) => {
            this.properties.poseSource = v;
        }, { values: ['from_input_image', 't_pose_reference'] });
    };

    BodyAnatomyMapperNode.prototype.onExecute = function () {
        const img = this.getInputData(0);
        this.setOutputData(0, {
            type: 'anatomy_data', bodyType: this.properties.bodyType,
            poseSource: this.properties.poseSource, hasReference: !!img,
        });
        this.setOutputData(1, img);
    };

    BodyAnatomyMapperNode.prototype.onDrawForeground = function (ctx) {
        ctx.fillStyle = '#80CBC4'; ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🦴 ${this.properties.bodyType}`, this.size[0] / 2, this.size[1] - 10);
    };

    LiteGraph.registerNodeType('ff/body_anatomy_mapper', BodyAnatomyMapperNode);
    BodyAnatomyMapperNode.bgcolor = COLORS.anatomy.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // COMPONENT SELECTOR NODE (Modular Outfit System)
    // ═══════════════════════════════════════════════════════════════════════

    function ComponentSelectorNode() {
        this.addInput('image', IMAGE_TYPE);
        this.addInput('face_data', FACE_TYPE);
        this.addInput('anatomy_data', ANATOMY_TYPE);
        this.addOutput('image', IMAGE_TYPE);
        this.properties = {
            isOnePiece: false, preserveFace: true, style: '',
            head: { enabled: false, description: '', referenceImage: null },
            face: { enabled: false, description: '', referenceImage: null },
            top: { enabled: true, description: '', referenceImage: null },
            bottom: { enabled: true, description: '', referenceImage: null },
            footwear: { enabled: false, description: '', referenceImage: null },
        };
        this.size = [320, 380];
        this.title = '🧩 Component Selector';
        this._slotThumbnails = {};
    }

    ComponentSelectorNode.title = '🧩 Component Selector';
    ComponentSelectorNode.desc = 'Tùy chỉnh từng bộ phận trang phục: Đầu, Mặt, Áo, Quần, Giày';

    ComponentSelectorNode.prototype.onAdded = function () {
        const slots = [
            { key: 'head', icon: '🎩', label: 'Đầu' },
            { key: 'face', icon: '🕶️', label: 'Mặt' },
            { key: 'top', icon: '👕', label: 'Áo' },
            { key: 'bottom', icon: '👖', label: 'Quần' },
            { key: 'footwear', icon: '👟', label: 'Giày' },
        ];
        for (const s of slots) {
            this.addWidget('toggle', `${s.icon} ${s.label}`, this.properties[s.key].enabled, (v) => {
                this.properties[s.key].enabled = v;
            });
            this.addWidget('text', `${s.label} mô tả`, '', (v) => {
                this.properties[s.key].description = v;
            });
        }
        this.addWidget('toggle', '👗 One-Piece', false, (v) => {
            this.properties.isOnePiece = v;
            if (v) this.properties.bottom.enabled = false;
        });
        this.addWidget('toggle', 'Giữ mặt', true, (v) => { this.properties.preserveFace = v; });
    };

    ComponentSelectorNode.prototype.onExecute = function () {
        const img = this.getInputData(0);
        const faceData = this.getInputData(1);
        const anatomyData = this.getInputData(2);
        this.setOutputData(0, {
            type: 'image', sourceImage: img, faceData, anatomyData,
            nodeType: 'component_selector',
            config: {
                ...this.properties, preserveFace: this.properties.preserveFace,
                isOnePiece: this.properties.isOnePiece,
            },
        });
    };

    ComponentSelectorNode.prototype.onDblClick = function (e, pos) {
        // Determine which slot was double-clicked based on Y position
        const slotKeys = ['head', 'face', 'top', 'bottom', 'footwear'];
        const slotIdx = Math.floor((pos[1] - 30) / 60);
        if (slotIdx < 0 || slotIdx >= slotKeys.length) return;
        const slot = slotKeys[slotIdx];

        const url = prompt(`Nhập URL hình ảnh tham chiếu cho phần [${slot}] - Hoặc để trống / Hủy để tải từ máy:`);
        if (url) {
            if (window.app && window.API) {
                window.app.showToast(`Đang tải ảnh ${slot} từ đường dẫn...`, "info");
                window.API.fetchImageUrl(url).then(res => {
                    if (res.success && res.base64) {
                        this.properties[slot].referenceImage = res.base64;
                        const img = new Image();
                        img.onload = () => { this._slotThumbnails[slot] = img; this.setDirtyCanvas(true); };
                        img.src = res.dataUrl;
                    } else {
                        window.app.showToast("Tải ảnh thất bại.", "error");
                    }
                }).catch(e => window.app.showToast("Lỗi proxy tải ảnh: " + e.message, "error"));
            }
            return;
        }

        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (ev) => {
            const file = ev.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                this.properties[slot].referenceImage = re.target.result.split(',')[1];
                const img = new Image();
                img.onload = () => { this._slotThumbnails[slot] = img; this.setDirtyCanvas(true); };
                img.src = re.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    };

    ComponentSelectorNode.prototype.onDrawForeground = function (ctx) {
        const slotKeys = ['head', 'face', 'top', 'bottom', 'footwear'];
        let activeCount = 0;
        
        // Draw thumbnails for uploaded references on the right side
        const thumbSize = 30;
        const startY = 35;
        const thumbX = this.size[0] - thumbSize - 10;
        
        slotKeys.forEach((key, index) => {
            if (this.properties[key].enabled) activeCount++;
            
            const thumbY = startY + index * 42;
            
            if (this._slotThumbnails[key]) {
                ctx.drawImage(this._slotThumbnails[key], thumbX, thumbY, thumbSize, thumbSize);
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                ctx.fillRect(thumbX, thumbY, thumbSize, thumbSize);
            }
            
            // Draw small upload hint (+ icon) if enabled but no image
            if (this.properties[key].enabled && !this._slotThumbnails[key]) {
                ctx.fillStyle = '#9FA8DA';
                ctx.font = '12px Inter';
                ctx.textAlign = 'center';
                ctx.fillText('+', thumbX + thumbSize/2, thumbY + thumbSize/2 + 4);
            }
        });

        // Footer info
        let y = this.size[1] - 15;
        ctx.fillStyle = '#9FA8DA'; 
        ctx.font = '10px Inter, sans-serif'; 
        ctx.textAlign = 'center';
        ctx.fillText(`${activeCount}/5 slots active${this.properties.isOnePiece ? ' (One-Piece)' : ''}`,
            this.size[0] / 2, y);
    };

    LiteGraph.registerNodeType('ff/component_selector', ComponentSelectorNode);
    ComponentSelectorNode.bgcolor = COLORS.component.bg;

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITY: Register all node types globally
    // ═══════════════════════════════════════════════════════════════════════

    global.FFNodeTypes = {
        ImageInputNode,
        FaceReferenceNode,
        OutfitSelectorNode,
        PoseSelectorNode,
        StyleSelectorNode,
        OutputNode,
        CustomPromptNode,
        BodyAnatomyMapperNode,
        ComponentSelectorNode,
        COLORS,
    };

    console.log('[FF Nodes] ✓ 9 node types registered with LiteGraph');

})(window);
