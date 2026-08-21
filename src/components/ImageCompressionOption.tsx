'use client';

import React, { useState } from 'react';
import {
  Zap,
  ShieldCheck,
  FileImage,
  Sparkles,
  Layers,
  Info,
  Combine,
  Eye,
  CheckCircle2,
  Minimize2,
  Loader2,
  X,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { stitchImagesIntoSinglePanel, CompressionResult, formatFileSize } from '@/lib/image-compressor';

interface ImageCompressionOptionProps {
  // Compression options
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  targetKb?: number;
  onTargetKbChange?: (kb: number) => void;

  // Merge into single image options
  mergeIntoSingle?: boolean;
  onMergeToggle?: (enabled: boolean) => void;
  mergeTargetKb?: number;

  // Attached files for preview
  attachedImages?: (File | Blob | string)[];
  attachedCount?: number;

  className?: string;
  compact?: boolean;
}

export function ImageCompressionOption({
  enabled,
  onToggle,
  targetKb = 50,
  onTargetKbChange,
  mergeIntoSingle = false,
  onMergeToggle,
  mergeTargetKb = 150,
  attachedImages = [],
  attachedCount = 0,
  className = '',
  compact = false,
}: ImageCompressionOptionProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isStitching, setIsStitching] = useState(false);
  const [stitchedResult, setStitchedResult] = useState<CompressionResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const actualCount = attachedCount || attachedImages.length;
  const canMerge = actualCount >= 2;

  const handleOpenPreview = async () => {
    if (!attachedImages || attachedImages.length < 2) return;
    setIsPreviewOpen(true);
    setIsStitching(true);
    setPreviewError(null);

    try {
      const result = await stitchImagesIntoSinglePanel(attachedImages, {
        targetKb: mergeTargetKb,
        layout: 'auto',
        addBadges: true,
      });
      setStitchedResult(result);
    } catch (err: any) {
      console.error('Failed to generate preview of stitched image:', err);
      setPreviewError(err?.message || 'Failed to stitch images for preview.');
    } finally {
      setIsStitching(false);
    }
  };

  return (
    <div className={`space-y-2.5 ${className}`}>
      {/* 1. Main Compression / Multi-Image Optimization Container */}
      <div
        className={`p-3 rounded-2xl border transition-all ${
          enabled || (mergeIntoSingle && canMerge)
            ? 'bg-emerald-500/5 border-emerald-500/30 dark:bg-emerald-950/15'
            : 'bg-muted/40 border-border/70'
        }`}
      >
        {/* Top Row: Standard Compression */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div
              className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                enabled
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              <Zap className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label
                  htmlFor="compress-image-toggle"
                  className="text-xs sm:text-sm font-semibold text-foreground cursor-pointer"
                >
                  Compress individual images (~{targetKb}KB each)
                </Label>

                {enabled && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-mono px-1.5 py-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                  >
                    Token Saver
                  </Badge>
                )}

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center"
                        aria-label="Image compression info"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs space-y-1">
                      <p className="font-semibold text-foreground">Smart Document Compression</p>
                      <p>
                        Each uploaded page or photo is optimized to ~{targetKb}KB before sending to the AI model, dramatically saving tokens and speeding up inference.
                      </p>
                      <p className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 pt-1 font-medium">
                        <ShieldCheck className="h-3.5 w-3.5 inline shrink-0" />
                        Full-resolution original images are always preserved in your saved Case History!
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {!compact && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {enabled ? (
                    <span>
                      Reduces each page to ~{targetKb}KB for AI tokens • Original full-res preserved in history
                      {actualCount > 0 ? ` (${actualCount} file${actualCount > 1 ? 's' : ''} ready)` : ''}
                    </span>
                  ) : (
                    <span>Original file sizes will be sent to AI (higher token consumption)</span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Switch
              id="compress-image-toggle"
              checked={enabled}
              onCheckedChange={onToggle}
              aria-label="Toggle image compression for AI"
            />
          </div>
        </div>

        {/* 2. Stitch All Images into 1 Single Multi-Panel Image (~150KB) */}
        {onMergeToggle && (
          <div className="mt-3 pt-2.5 border-t border-border/60">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                    mergeIntoSingle && canMerge
                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Combine className="h-4 w-4" />
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Label
                      htmlFor="merge-images-toggle"
                      className="text-xs sm:text-sm font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
                    >
                      <span>Merge all pages into 1 single image for AI</span>
                    </Label>

                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono px-1.5 py-0 ${
                        mergeIntoSingle && canMerge
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30'
                          : 'bg-muted/60 text-muted-foreground'
                      }`}
                    >
                      ~{mergeTargetKb}KB Total
                    </Badge>

                    {canMerge && mergeIntoSingle && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                        <CheckCircle2 className="h-3 w-3 inline" />
                        {actualCount} images → 1 panel
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Attaches multiple pages side-by-side into 1 composite canvas (~{mergeTargetKb}KB total) so AI receives a single visual prompt.
                    <span className="text-foreground/80 font-medium"> Original separate files remain saved in Case History.</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {canMerge && attachedImages.length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenPreview}
                    className="h-7 text-xs gap-1 px-2.5 rounded-lg border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                  >
                    <Eye className="h-3 w-3" />
                    <span>Preview AI Panel</span>
                  </Button>
                )}

                <Switch
                  id="merge-images-toggle"
                  checked={mergeIntoSingle}
                  onCheckedChange={onMergeToggle}
                  aria-label="Toggle merging all images into 1 single image for AI"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Live Preview Dialog for Merged Multi-Panel Image */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-5 rounded-2xl">
          <DialogHeader className="pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600">
                  <Combine className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground">
                    Merged Single-Image AI Preview
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    How the AI model will receive your {actualCount} attached pages in a single composite layout.
                  </DialogDescription>
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {isStitching && (
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <p className="text-xs font-medium text-muted-foreground">
                  Stitching {actualCount} documents side-by-side &amp; optimizing to ~{mergeTargetKb}KB...
                </p>
              </div>
            )}

            {previewError && (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {previewError}
              </div>
            )}

            {!isStitching && stitchedResult && (
              <div className="space-y-3">
                {/* Stats Header */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-muted/50 border border-border">
                    <p className="text-[10px] text-muted-foreground">Original Total Size</p>
                    <p className="font-bold text-foreground font-mono">{formatFileSize(stitchedResult.originalSizeBytes)}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-300">Merged AI Size</p>
                    <p className="font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                      {formatFileSize(stitchedResult.sizeBytes)} ({stitchedResult.sizeKb} KB)
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <p className="text-[10px] text-blue-700 dark:text-blue-300">Token Reduction</p>
                    <p className="font-bold text-blue-700 dark:text-blue-300 font-mono">
                      {stitchedResult.reductionPercentage}% smaller
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-muted/50 border border-border">
                    <p className="text-[10px] text-muted-foreground">AI Canvas Dimensions</p>
                    <p className="font-bold text-foreground font-mono">
                      {stitchedResult.width} × {stitchedResult.height} px
                    </p>
                  </div>
                </div>

                {/* Stitched Image Canvas Display */}
                <div className="rounded-xl border border-border bg-slate-900/5 dark:bg-slate-900/40 p-2 overflow-hidden flex justify-center items-center">
                  <img
                    src={stitchedResult.dataUrl}
                    alt="Merged Composite for AI"
                    className="max-h-[50vh] w-auto object-contain rounded-lg shadow-sm border border-slate-200 dark:border-slate-800"
                  />
                </div>

                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                  <p>
                    <strong>History Guarantee:</strong> This composite panel is generated purely for the AI vision prompt. All <strong>{actualCount} original high-resolution files</strong> are preserved individually and untouched in your patient case records!
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

