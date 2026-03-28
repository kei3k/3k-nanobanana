// =============================================================================
// 3K Nanobana — Canvas Masking Tool
// =============================================================================
// HTML5 Canvas-based brush tool for selecting image regions to edit
// =============================================================================

const MaskTool = {
    canvas: null,
    ctx: null,
    isDrawing: false,
    tool: 'brush',       // 'brush' or 'eraser'
    brushSize: 30,
    imageElement: null,
    maskData: null,       // Bounding box of the masked region

    /**
     * Initialize the mask canvas with an image
     */
    init(imageUrl) {
        this.canvas = document.getElementById('mask-canvas');
        this.ctx = this.canvas.getContext('2d');

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.imageElement = img;

                // Scale to fit screen (max 80vw × 70vh)
                const maxW = window.innerWidth * 0.8;
                const maxH = window.innerHeight * 0.7;
                let w = img.width;
                let h = img.height;

                if (w > maxW) { h *= maxW / w; w = maxW; }
                if (h > maxH) { w *= maxH / h; h = maxH; }

                this.canvas.width = Math.floor(w);
                this.canvas.height = Math.floor(h);

                // Draw the image
                this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);

                // Bind events
                this._bindEvents();
                this.maskData = null;
                resolve();
            };
            img.src = imageUrl;
        });
    },

    /**
     * Bind mouse/touch events
     */
    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._startDraw(e));
        this.canvas.addEventListener('mousemove', (e) => this._draw(e));
        this.canvas.addEventListener('mouseup', () => this._stopDraw());
        this.canvas.addEventListener('mouseleave', () => this._stopDraw());

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this._startDraw(e.touches[0]);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this._draw(e.touches[0]);
        });
        this.canvas.addEventListener('touchend', () => this._stopDraw());
    },

    /**
     * Start drawing
     */
    _startDraw(e) {
        this.isDrawing = true;
        this._draw(e);
    },

    /**
     * Draw/erase on canvas
     */
    _draw(e) {
        if (!this.isDrawing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.ctx.globalCompositeOperation = this.tool === 'eraser' 
            ? 'destination-out' 
            : 'source-over';

        if (this.tool === 'brush') {
            // Draw semi-transparent red mask
            this.ctx.fillStyle = 'rgba(255, 60, 60, 0.45)';
            this.ctx.beginPath();
            this.ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
            this.ctx.fill();
        } else {
            // Eraser — restore original image in that area
            this.ctx.beginPath();
            this.ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Redraw image under erased area
            this.ctx.globalCompositeOperation = 'destination-over';
            this.ctx.drawImage(this.imageElement, 0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.globalCompositeOperation = 'source-over';
    },

    /**
     * Stop drawing
     */
    _stopDraw() {
        this.isDrawing = false;
    },

    /**
     * Set the active tool
     */
    setTool(tool) {
        this.tool = tool;
        document.getElementById('mask-brush-btn').classList.toggle('active', tool === 'brush');
        document.getElementById('mask-eraser-btn').classList.toggle('active', tool === 'eraser');
    },

    /**
     * Set brush size
     */
    setBrushSize(size) {
        this.brushSize = parseInt(size);
    },

    /**
     * Clear all mask strokes and redraw original image
     */
    clear() {
        if (this.imageElement) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(this.imageElement, 0, 0, this.canvas.width, this.canvas.height);
        }
        this.maskData = null;
    },

    /**
     * Calculate the bounding box of the masked (red) region
     * Returns { x, y, width, height, imageWidth, imageHeight }
     */
    calculateMaskBounds() {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const pixels = imageData.data;
        
        let minX = this.canvas.width, minY = this.canvas.height;
        let maxX = 0, maxY = 0;
        let hasMask = false;

        // Find pixels that are significantly red (from our brush)
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];

            // Detect our red mask overlay (high red, low green/blue)
            if (r > 180 && g < 100 && b < 100 && a > 50) {
                const pixelIndex = i / 4;
                const x = pixelIndex % this.canvas.width;
                const y = Math.floor(pixelIndex / this.canvas.width);
                
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                hasMask = true;
            }
        }

        if (!hasMask) return null;

        // Add padding
        const pad = 10;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(this.canvas.width, maxX + pad);
        maxY = Math.min(this.canvas.height, maxY + pad);

        this.maskData = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            imageWidth: this.canvas.width,
            imageHeight: this.canvas.height,
        };

        return this.maskData;
    },

    /**
     * Get the current mask data
     */
    getMaskData() {
        return this.maskData;
    },

    /**
     * Destroy and clean up
     */
    destroy() {
        this.canvas = null;
        this.ctx = null;
        this.imageElement = null;
        this.maskData = null;
        this.isDrawing = false;
    },
};
