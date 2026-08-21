'use client';

export interface CompressionResult {
  dataUrl: string;
  base64: string;
  mimeType: string;
  sizeBytes: number;
  sizeKb: number;
  originalSizeBytes: number;
  originalSizeKb: number;
  reductionPercentage: number;
  width: number;
  height: number;
}

export interface CompressionOptions {
  targetKb?: number; // target max size in kilobytes (default: 50KB)
  maxDimension?: number; // max width/height in px (default: 1200px)
  minQuality?: number; // min jpeg quality before downscaling further (default: 0.3)
}

/**
 * Formats byte size into human readable string (e.g., "1.2 MB", "48 KB", "850 B").
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Calculates raw byte size from a base64 string or data URL.
 */
export function getBase64ByteSize(base64OrDataUrl: string): number {
  if (!base64OrDataUrl) return 0;
  const base64 = base64OrDataUrl.includes('base64,')
    ? base64OrDataUrl.split('base64,')[1]
    : base64OrDataUrl;
  const padding = (base64.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Compresses an image (File, Blob, Data URI, or Base64) to a target size (default 50KB).
 * Uses iterative high-quality canvas resizing and JPEG quality optimization.
 */
export async function compressImageToTargetKb(
  input: File | Blob | string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const targetKb = options.targetKb || 50;
  const targetBytes = targetKb * 1024;
  const initialMaxDim = options.maxDimension || 1200;

  if (typeof window === 'undefined') {
    throw new Error('Image compression must run in browser.');
  }

  // 1. Resolve source image and original size
  let src = '';
  let originalSizeBytes = 0;

  if (typeof input === 'string') {
    if (input.startsWith('data:') || input.startsWith('blob:') || input.startsWith('http')) {
      src = input;
    } else {
      src = `data:image/jpeg;base64,${input}`;
    }
    originalSizeBytes = getBase64ByteSize(src);
  } else if (input instanceof Blob || input instanceof File) {
    originalSizeBytes = input.size;
    src = URL.createObjectURL(input);
  }

  // 2. Load image into HTMLImageElement
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = src;
  });

  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;

  // 3. Iterative canvas scaling & quality compression loop
  let currentMaxDim = Math.min(initialMaxDim, Math.max(naturalWidth, naturalHeight));
  let quality = 0.85;
  let bestDataUrl = '';
  let bestSizeBytes = Infinity;
  let bestWidth = naturalWidth;
  let bestHeight = naturalHeight;

  // Up to 8 optimization passes to hit ~50KB while preserving maximal clinical clarity
  for (let pass = 0; pass < 8; pass++) {
    let width = naturalWidth;
    let height = naturalHeight;

    if (width > currentMaxDim || height > currentMaxDim) {
      if (width > height) {
        height = Math.round((height * currentMaxDim) / width);
        width = currentMaxDim;
      } else {
        width = Math.round((width * currentMaxDim) / height);
        height = currentMaxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) break;

    // Crisp rendering for medical documents / charts
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // White background to avoid transparent alpha artifacts
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const candidateDataUrl = canvas.toDataURL('image/jpeg', quality);
    const candidateBytes = getBase64ByteSize(candidateDataUrl);

    bestDataUrl = candidateDataUrl;
    bestSizeBytes = candidateBytes;
    bestWidth = width;
    bestHeight = height;

    // If within target (e.g. <= 50KB + 5% tolerance), we found a great balance
    if (candidateBytes <= targetBytes * 1.05) {
      break;
    }

    // Otherwise, adjust parameters for next pass
    if (quality > 0.6) {
      quality -= 0.15;
    } else if (currentMaxDim > 800) {
      currentMaxDim = Math.round(currentMaxDim * 0.8);
      quality = 0.7;
    } else if (quality > 0.35) {
      quality -= 0.12;
    } else if (currentMaxDim > 500) {
      currentMaxDim = Math.round(currentMaxDim * 0.75);
      quality = 0.5;
    } else {
      quality = Math.max(0.2, quality - 0.1);
      currentMaxDim = Math.round(currentMaxDim * 0.85);
    }
  }

  // Clean up object URL if created
  if (typeof input !== 'string' && src.startsWith('blob:')) {
    URL.revokeObjectURL(src);
  }

  const base64 = bestDataUrl.includes('base64,')
    ? bestDataUrl.split('base64,')[1]
    : bestDataUrl;

  const reductionPercentage =
    originalSizeBytes > 0
      ? Math.max(0, Math.round(((originalSizeBytes - bestSizeBytes) / originalSizeBytes) * 100))
      : 0;

  return {
    dataUrl: bestDataUrl,
    base64,
    mimeType: 'image/jpeg',
    sizeBytes: bestSizeBytes,
    sizeKb: Math.round(bestSizeBytes / 1024),
    originalSizeBytes: originalSizeBytes || bestSizeBytes,
    originalSizeKb: Math.round((originalSizeBytes || bestSizeBytes) / 1024),
    reductionPercentage,
    width: bestWidth,
    height: bestHeight,
  };
}

/**
 * Compresses an array of files or data URIs to target size (default 50KB) for AI API calls.
 */
export async function compressImagesForAi(
  images: (File | Blob | string)[],
  targetKb = 50
): Promise<string[]> {
  if (!images || images.length === 0) return [];

  const results = await Promise.all(
    images.map(async (img) => {
      // Audio or non-image items (like audio recorded webm) are kept as is
      if (typeof img === 'string' && (img.startsWith('data:audio') || img.includes('audio/'))) {
        return img;
      }
      if (img instanceof File && img.type.startsWith('audio/')) {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(img);
        });
      }

      try {
        const compressed = await compressImageToTargetKb(img, { targetKb });
        return compressed.dataUrl;
      } catch (err) {
        console.warn('Image compression fallback to original:', err);
        if (typeof img === 'string') return img;
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(img);
        });
      }
    })
  );

  return results;
}
