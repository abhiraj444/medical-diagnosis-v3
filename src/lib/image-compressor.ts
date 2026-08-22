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
  imageCount?: number;
}

export interface CompressionOptions {
  targetKb?: number; // target max size in kilobytes (default: 50KB)
  maxDimension?: number; // max width/height in px (default: 1200px)
  minQuality?: number; // min jpeg quality before downscaling further (default: 0.3)
}

export interface StitchOptions {
  targetKb?: number; // target max size in kilobytes (default: 150KB)
  layout?: 'side-by-side' | 'grid' | 'vertical' | 'auto';
  addBadges?: boolean; // Draw subtle "[Page 1]", "[Page 2]" label headers
  maxDimension?: number; // max canvas dimension in px (default: 2000px)
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
 * Helper to load an image source into an HTMLImageElement with cleanup.
 */
/**
 * Helper to load an image source into an HTMLImageElement with cleanup.
 * Removes crossOrigin='anonymous' for data/blob URIs to prevent canvas tainting/blank renders,
 * and ensures image is fully decoded before returning.
 */
async function loadHtmlImage(input: File | Blob | string): Promise<{ img: HTMLImageElement; byteSize: number; cleanup?: () => void }> {
  let src = '';
  let byteSize = 0;
  let cleanup: (() => void) | undefined;

  if (typeof input === 'string') {
    if (input.startsWith('data:') || input.startsWith('blob:') || input.startsWith('http://') || input.startsWith('https://')) {
      src = input;
    } else {
      src = `data:image/jpeg;base64,${input}`;
    }
    byteSize = getBase64ByteSize(src);
  } else if (input instanceof Blob || input instanceof File) {
    byteSize = input.size;
    // Use FileReader to get solid Data URI in memory
    src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file as data URI'));
      reader.readAsDataURL(input);
    });
  }

  const img = new Image();
  // Only set crossOrigin for external http(s) URLs. NEVER set on data: or blob: URIs
  if (src.startsWith('http://') || src.startsWith('https://')) {
    img.crossOrigin = 'anonymous';
  }

  await new Promise<void>((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    img.onload = async () => {
      try {
        if ('decode' in img) {
          await img.decode().catch(() => {});
        }
      } catch {
        // ignore decode fallback
      }
      resolve();
    };
    img.onerror = () => reject(new Error('Failed to load image element into DOM'));
    img.src = src;
  });

  return { img, byteSize, cleanup };
}

/**
 * Compresses an image (File, Blob, Data URI, or Base64) to a target size (default 50KB).
 * Uses iterative high-quality canvas resizing and JPEG quality optimization.
 * Maintains minimum resolution and contrast so medical text remains 100% legible for AI.
 */
export async function compressImageToTargetKb(
  input: File | Blob | string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const targetKb = options.targetKb || 50;
  const targetBytes = targetKb * 1024;
  const initialMaxDim = options.maxDimension || 1600;

  if (typeof window === 'undefined') {
    throw new Error('Image compression must run in browser.');
  }

  const { img, byteSize: originalSizeBytes, cleanup } = await loadHtmlImage(input);

  const naturalWidth = img.naturalWidth || img.width || 800;
  const naturalHeight = img.naturalHeight || img.height || 600;

  // Preserve readable bounds (never shrink below 700px for text/medical reports)
  const minReadableDim = Math.min(700, Math.min(naturalWidth, naturalHeight));

  // Iterative canvas scaling & quality compression loop
  let currentMaxDim = Math.min(initialMaxDim, Math.max(naturalWidth, naturalHeight));
  let quality = 0.86;
  let bestDataUrl = '';
  let bestSizeBytes = Infinity;
  let bestWidth = naturalWidth;
  let bestHeight = naturalHeight;

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

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Solid white background to prevent transparent JPEG blackening
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const candidateDataUrl = canvas.toDataURL('image/jpeg', quality);
    const candidateBytes = getBase64ByteSize(candidateDataUrl);

    if (candidateDataUrl && candidateDataUrl.length > 100) {
      bestDataUrl = candidateDataUrl;
      bestSizeBytes = candidateBytes;
      bestWidth = width;
      bestHeight = height;
    }

    if (candidateBytes <= targetBytes * 1.08) {
      break;
    }

    // Step-down tuning while safeguarding minimum visual sharpness
    if (quality > 0.65) {
      quality -= 0.12;
    } else if (currentMaxDim > 1100 && currentMaxDim > minReadableDim) {
      currentMaxDim = Math.max(minReadableDim, Math.round(currentMaxDim * 0.8));
      quality = 0.75;
    } else if (quality > 0.50) {
      quality -= 0.08;
    } else if (currentMaxDim > 800 && currentMaxDim > minReadableDim) {
      currentMaxDim = Math.max(minReadableDim, Math.round(currentMaxDim * 0.85));
      quality = 0.60;
    } else {
      quality = Math.max(0.40, quality - 0.05);
      break;
    }
  }

  if (cleanup) cleanup();

  // If compression failed to produce a valid image, fallback to raw input if string
  if (!bestDataUrl || bestDataUrl.length < 100) {
    if (typeof input === 'string') {
      const fbUrl = input.startsWith('data:') ? input : `data:image/jpeg;base64,${input}`;
      return {
        dataUrl: fbUrl,
        base64: fbUrl.includes('base64,') ? fbUrl.split('base64,')[1] : fbUrl,
        mimeType: 'image/jpeg',
        sizeBytes: originalSizeBytes || 50000,
        sizeKb: Math.round((originalSizeBytes || 50000) / 1024),
        originalSizeBytes: originalSizeBytes || 50000,
        originalSizeKb: Math.round((originalSizeBytes || 50000) / 1024),
        reductionPercentage: 0,
        width: naturalWidth,
        height: naturalHeight,
      };
    }
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
 * Merges/stitches multiple images into a single side-by-side or grid multi-panel image,
 * and compresses the combined canvas down to a target size (default 150KB) for AI vision prompts.
 */
export async function stitchImagesIntoSinglePanel(
  images: (File | Blob | string)[],
  options: StitchOptions = {}
): Promise<CompressionResult> {
  const targetKb = options.targetKb || 150;
  const targetBytes = targetKb * 1024;
  const addBadges = options.addBadges !== false;
  const maxDimTarget = options.maxDimension || 2200;

  if (typeof window === 'undefined') {
    throw new Error('Image stitching must run in browser.');
  }

  // Filter out audio inputs if any
  const imageInputs = images.filter((item) => {
    if (typeof item === 'string') {
      return !item.startsWith('data:audio') && !item.includes('audio/');
    }
    if (item instanceof File || item instanceof Blob) {
      return !item.type.startsWith('audio/');
    }
    return true;
  });

  if (imageInputs.length === 0) {
    throw new Error('No valid images provided for stitching.');
  }

  // If only 1 image, simply compress to targetKb
  if (imageInputs.length === 1) {
    const singleResult = await compressImageToTargetKb(imageInputs[0], { targetKb });
    return { ...singleResult, imageCount: 1 };
  }

  // 1. Load all images
  const loadedItems = await Promise.all(imageInputs.map(loadHtmlImage));
  const totalOriginalBytes = loadedItems.reduce((acc, curr) => acc + curr.byteSize, 0);

  // 2. Determine Layout (side-by-side for 2, 2x2 grid for 3-4, multi-column grid for 5+)
  const count = loadedItems.length;
  let cols = 2;
  let rows = 1;

  if (options.layout === 'side-by-side') {
    cols = count;
    rows = 1;
  } else if (options.layout === 'vertical') {
    cols = 1;
    rows = count;
  } else if (options.layout === 'grid' || options.layout === 'auto' || !options.layout) {
    if (count === 2) {
      cols = 2;
      rows = 1;
    } else if (count <= 4) {
      cols = 2;
      rows = Math.ceil(count / 2);
    } else if (count <= 6) {
      cols = 3;
      rows = Math.ceil(count / 3);
    } else {
      cols = 3;
      rows = Math.ceil(count / 3);
    }
  }

  // Normalize cell dimensions based on average aspect ratio of loaded images
  let avgAspect = 1.25; // default portrait aspect ratio (height / width)
  try {
    const aspects = loadedItems.map((item) => {
      const w = item.img.naturalWidth || item.img.width || 800;
      const h = item.img.naturalHeight || item.img.height || 1000;
      return h / Math.max(1, w);
    });
    avgAspect = aspects.reduce((a, b) => a + b, 0) / aspects.length;
  } catch {
    avgAspect = 1.25;
  }

  // Base cell size scaled for high-density document rendering
  const baseCellWidth = avgAspect > 1 ? 800 : 1000;
  const baseCellHeight = Math.round(baseCellWidth * Math.min(1.8, Math.max(0.6, avgAspect)));
  const gap = 14;
  const headerHeight = addBadges ? 34 : 8;
  const padding = 16;

  // Calculate master canvas size
  const masterWidth = padding * 2 + cols * baseCellWidth + (cols - 1) * gap;
  const masterHeight = padding * 2 + rows * (baseCellHeight + headerHeight) + (rows - 1) * gap;

  // 3. Render master high-resolution composition canvas
  const masterCanvas = document.createElement('canvas');
  masterCanvas.width = masterWidth;
  masterCanvas.height = masterHeight;
  const mCtx = masterCanvas.getContext('2d');

  if (!mCtx) {
    loadedItems.forEach((item) => item.cleanup?.());
    throw new Error('Could not create master canvas context');
  }

  mCtx.imageSmoothingEnabled = true;
  mCtx.imageSmoothingQuality = 'high';

  // Crisp light medical background
  mCtx.fillStyle = '#f8fafc';
  mCtx.fillRect(0, 0, masterWidth, masterHeight);

  // Draw outer border outline
  mCtx.strokeStyle = '#cbd5e1';
  mCtx.lineWidth = 2;
  mCtx.strokeRect(2, 2, masterWidth - 4, masterHeight - 4);

  // Place each image in its grid slot
  for (let idx = 0; idx < count; idx++) {
    const colIdx = idx % cols;
    const rowIdx = Math.floor(idx / cols);

    const cellX = padding + colIdx * (baseCellWidth + gap);
    const cellY = padding + rowIdx * (baseCellHeight + headerHeight + gap);

    // Draw document panel background & card border
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(cellX, cellY, baseCellWidth, baseCellHeight + headerHeight);
    mCtx.strokeStyle = '#e2e8f0';
    mCtx.lineWidth = 1.5;
    mCtx.strokeRect(cellX, cellY, baseCellWidth, baseCellHeight + headerHeight);

    // Draw Page Badge / Header Banner
    if (addBadges) {
      mCtx.fillStyle = '#0f172a';
      mCtx.fillRect(cellX, cellY, baseCellWidth, 28);

      mCtx.fillStyle = '#38bdf8';
      mCtx.fillRect(cellX, cellY + 26, baseCellWidth, 2);

      mCtx.fillStyle = '#ffffff';
      mCtx.font = 'bold 13px ui-sans-serif, system-ui, -apple-system, sans-serif';
      mCtx.textBaseline = 'middle';
      mCtx.fillText(`PAGE ${idx + 1} OF ${count} — MEDICAL ATTACHMENT`, cellX + 12, cellY + 14);
    }

    const { img } = loadedItems[idx];
    const nW = img.naturalWidth || img.width || 800;
    const nH = img.naturalHeight || img.height || 600;

    // Aspect ratio fit within cell preserving maximum legible area
    const targetW = baseCellWidth - 16;
    const targetH = baseCellHeight - 16;

    const scale = Math.min(targetW / nW, targetH / nH);
    const renderW = Math.max(10, Math.round(nW * scale));
    const renderH = Math.max(10, Math.round(nH * scale));

    const renderX = cellX + Math.round((baseCellWidth - renderW) / 2);
    const renderY = cellY + headerHeight + Math.round((baseCellHeight - renderH) / 2);

    // Fill white background for inner document area
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(renderX, renderY, renderW, renderH);

    // Draw image safely onto canvas
    mCtx.drawImage(img, renderX, renderY, renderW, renderH);

    // Clean subtle boundary
    mCtx.strokeStyle = '#cbd5e1';
    mCtx.lineWidth = 1;
    mCtx.strokeRect(renderX, renderY, renderW, renderH);
  }

  // Clean up loaded image blobs
  loadedItems.forEach((item) => item.cleanup?.());

  // 4. Iterative scaling & compression to reach <= ~150KB while preserving AI vision OCR legibility
  let currentMaxDim = Math.min(maxDimTarget, Math.max(masterWidth, masterHeight));
  let quality = 0.85;
  let bestDataUrl = '';
  let bestSizeBytes = Infinity;
  let bestWidth = masterWidth;
  let bestHeight = masterHeight;

  // Minimum readable dimension for stitched composite
  const minCompositeDim = Math.min(1400, Math.max(masterWidth, masterHeight));

  for (let pass = 0; pass < 8; pass++) {
    let outW = masterWidth;
    let outH = masterHeight;

    if (outW > currentMaxDim || outH > currentMaxDim) {
      if (outW > outH) {
        outH = Math.round((outH * currentMaxDim) / outW);
        outW = currentMaxDim;
      } else {
        outW = Math.round((outW * currentMaxDim) / outH);
        outH = currentMaxDim;
      }
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.max(1, outW);
    outCanvas.height = Math.max(1, outH);
    const oCtx = outCanvas.getContext('2d');
    if (!oCtx) break;

    oCtx.imageSmoothingEnabled = true;
    oCtx.imageSmoothingQuality = 'high';

    oCtx.fillStyle = '#ffffff';
    oCtx.fillRect(0, 0, outW, outH);
    oCtx.drawImage(masterCanvas, 0, 0, outW, outH);

    const candidateDataUrl = outCanvas.toDataURL('image/jpeg', quality);
    const candidateBytes = getBase64ByteSize(candidateDataUrl);

    if (candidateDataUrl && candidateDataUrl.length > 100) {
      bestDataUrl = candidateDataUrl;
      bestSizeBytes = candidateBytes;
      bestWidth = outW;
      bestHeight = outH;
    }

    if (candidateBytes <= targetBytes * 1.1) {
      break;
    }

    if (quality > 0.65) {
      quality -= 0.10;
    } else if (currentMaxDim > 1600 && currentMaxDim > minCompositeDim) {
      currentMaxDim = Math.max(minCompositeDim, Math.round(currentMaxDim * 0.85));
      quality = 0.75;
    } else if (quality > 0.50) {
      quality -= 0.08;
    } else {
      quality = Math.max(0.40, quality - 0.05);
      break;
    }
  }

  const base64 = bestDataUrl.includes('base64,')
    ? bestDataUrl.split('base64,')[1]
    : bestDataUrl;

  const reductionPercentage =
    totalOriginalBytes > 0
      ? Math.max(0, Math.round(((totalOriginalBytes - bestSizeBytes) / totalOriginalBytes) * 100))
      : 0;

  return {
    dataUrl: bestDataUrl,
    base64,
    mimeType: 'image/jpeg',
    sizeBytes: bestSizeBytes,
    sizeKb: Math.round(bestSizeBytes / 1024),
    originalSizeBytes: totalOriginalBytes || bestSizeBytes,
    originalSizeKb: Math.round((totalOriginalBytes || bestSizeBytes) / 1024),
    reductionPercentage,
    width: bestWidth,
    height: bestHeight,
    imageCount: count,
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

/**
 * Master dispatcher: Prepares images for AI prompts based on compression & stitch settings.
 * If mergeIntoSingle is enabled and there are >= 2 images, it stitches them into 1 single ~150KB image.
 * Otherwise, it applies individual compression (~50KB) or returns originals.
 */
export async function prepareImagesForAiPrompt(options: {
  images: (File | Blob | string)[];
  compressEnabled?: boolean;
  mergeIntoSingle?: boolean;
  targetKb?: number;
  mergeTargetKb?: number;
}): Promise<{
  processedImages: string[];
  isMerged: boolean;
  imageCount: number;
  summaryText: string;
}> {
  const {
    images,
    compressEnabled = true,
    mergeIntoSingle = false,
    targetKb = 50,
    mergeTargetKb = 150,
  } = options;

  if (!images || images.length === 0) {
    return { processedImages: [], isMerged: false, imageCount: 0, summaryText: '' };
  }

  // Separate image vs audio items
  const imageItems: (File | Blob | string)[] = [];
  const audioDataUrls: string[] = [];

  for (const item of images) {
    if (typeof item === 'string') {
      if (item.startsWith('data:audio') || item.includes('audio/')) {
        audioDataUrls.push(item);
      } else {
        imageItems.push(item);
      }
    } else if (item instanceof File || item instanceof Blob) {
      if (item.type.startsWith('audio/')) {
        const audioUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(item);
        });
        audioDataUrls.push(audioUrl);
      } else {
        imageItems.push(item);
      }
    }
  }

  // Case A: User enabled "Merge all into 1 image" and we have >= 2 images
  if (mergeIntoSingle && imageItems.length > 1) {
    try {
      const stitched = await stitchImagesIntoSinglePanel(imageItems, { targetKb: mergeTargetKb });
      return {
        processedImages: [stitched.dataUrl, ...audioDataUrls],
        isMerged: true,
        imageCount: imageItems.length,
        summaryText: `Merged ${imageItems.length} pages into 1 composite panel (~${stitched.sizeKb}KB)`,
      };
    } catch (err) {
      console.warn('Image stitching failed, falling back to individual compression:', err);
    }
  }

  // Case B: Individual compression (~50KB per page)
  if (compressEnabled && imageItems.length > 0) {
    const compressedImages = await compressImagesForAi(imageItems, targetKb);
    return {
      processedImages: [...compressedImages, ...audioDataUrls],
      isMerged: false,
      imageCount: imageItems.length,
      summaryText: `Optimized ${imageItems.length} image(s) to ~${targetKb}KB each`,
    };
  }

  // Case C: Raw original images
  const rawUrls = await Promise.all(
    imageItems.map((img) => {
      if (typeof img === 'string') return Promise.resolve(img);
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(img);
      });
    })
  );

  return {
    processedImages: [...rawUrls, ...audioDataUrls],
    isMerged: false,
    imageCount: imageItems.length,
    summaryText: `Sent ${imageItems.length} original image(s)`,
  };
}

