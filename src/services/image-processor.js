// =============================================================================
// 3K Nanobana — Image Processor
// =============================================================================
// High-performance image utilities using Sharp
// Handles: save, thumbnail, resize, format conversion, metadata
// =============================================================================

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const IMAGE_DIR = process.env.IMAGE_DIR || './data/images';

/**
 * Ensure the image storage directories exist
 */
function ensureDirectories() {
    const dirs = [
        IMAGE_DIR,
        path.join(IMAGE_DIR, 'originals'),
        path.join(IMAGE_DIR, 'generated'),
        path.join(IMAGE_DIR, 'thumbnails'),
        path.join(IMAGE_DIR, 'exports'),
    ];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

/**
 * Save a base64 image to disk
 * @returns {Object} { filename, path, thumbnailPath, width, height, fileSize }
 */
async function saveBase64Image(base64Data, options = {}) {
    ensureDirectories();
    
    const {
        subfolder = 'generated',
        format = 'png',
        filename = `${uuidv4()}.${format}`,
        createThumbnail = true,
    } = options;

    const buffer = Buffer.from(base64Data, 'base64');
    const filePath = path.join(IMAGE_DIR, subfolder, filename);
    
    // Write the full-size image
    await sharp(buffer)
        .toFormat(format, { quality: 95 })
        .toFile(filePath);

    // Get metadata
    const metadata = await sharp(filePath).metadata();

    let thumbnailPath = null;
    if (createThumbnail) {
        thumbnailPath = path.join(IMAGE_DIR, 'thumbnails', `thumb_${filename}`);
        await sharp(buffer)
            .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
            .toFormat('webp', { quality: 80 })
            .toFile(thumbnailPath.replace(path.extname(thumbnailPath), '.webp'));
        thumbnailPath = thumbnailPath.replace(path.extname(thumbnailPath), '.webp');
    }

    const stats = fs.statSync(filePath);

    return {
        filename,
        path: filePath,
        thumbnailPath,
        width: metadata.width,
        height: metadata.height,
        fileSize: stats.size,
        format: metadata.format,
    };
}

/**
 * Save an uploaded file (multer buffer)
 */
async function saveUploadedFile(fileBuffer, originalName, mimeType) {
    ensureDirectories();
    
    const ext = path.extname(originalName) || '.png';
    const filename = `${uuidv4()}${ext}`;
    const filePath = path.join(IMAGE_DIR, 'originals', filename);

    await sharp(fileBuffer).toFile(filePath);

    const metadata = await sharp(filePath).metadata();

    // Create thumbnail
    const thumbnailFilename = `thumb_${uuidv4()}.webp`;
    const thumbnailPath = path.join(IMAGE_DIR, 'thumbnails', thumbnailFilename);
    await sharp(fileBuffer)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .toFormat('webp', { quality: 80 })
        .toFile(thumbnailPath);

    const stats = fs.statSync(filePath);

    return {
        filename,
        path: filePath,
        thumbnailPath,
        width: metadata.width,
        height: metadata.height,
        fileSize: stats.size,
        mimeType: mimeType || `image/${metadata.format}`,
        base64: fileBuffer.toString('base64'),
    };
}

/**
 * Read an image file and return base64
 */
async function readImageAsBase64(imagePath) {
    const buffer = fs.readFileSync(imagePath);
    const metadata = await sharp(buffer).metadata();
    return {
        base64: buffer.toString('base64'),
        mimeType: `image/${metadata.format}`,
        width: metadata.width,
        height: metadata.height,
    };
}

/**
 * Export image in a specific format (for batch export)
 * @param {string} sourcePath - Source image path
 * @param {string} format - 'png', 'tiff', 'jpeg', 'webp'
 * @param {Object} options - Export options
 */
async function exportImage(sourcePath, format = 'png', options = {}) {
    ensureDirectories();
    
    const basename = path.basename(sourcePath, path.extname(sourcePath));
    const exportFilename = `${basename}_export.${format}`;
    const exportPath = path.join(IMAGE_DIR, 'exports', exportFilename);

    let pipeline = sharp(sourcePath);

    // Resize if requested
    if (options.width || options.height) {
        pipeline = pipeline.resize(options.width, options.height, {
            fit: 'inside',
            withoutEnlargement: false,
        });
    }

    // Convert format
    switch (format) {
        case 'png':
            pipeline = pipeline.png({ quality: 100, compressionLevel: 6 });
            break;
        case 'tiff':
            pipeline = pipeline.tiff({ quality: 100, compression: 'lzw' });
            break;
        case 'jpeg':
        case 'jpg':
            pipeline = pipeline.jpeg({ quality: options.quality || 95 });
            break;
        case 'webp':
            pipeline = pipeline.webp({ quality: options.quality || 90 });
            break;
    }

    await pipeline.toFile(exportPath);
    
    return {
        path: exportPath,
        filename: exportFilename,
        format,
    };
}

module.exports = {
    ensureDirectories,
    saveBase64Image,
    saveUploadedFile,
    readImageAsBase64,
    exportImage,
};
