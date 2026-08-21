'use client';

import React from 'react';
import { Zap, ShieldCheck, FileImage, Sparkles, Layers, Info } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ImageCompressionOptionProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  targetKb?: number;
  onTargetKbChange?: (kb: number) => void;
  attachedCount?: number;
  className?: string;
  compact?: boolean;
}

export function ImageCompressionOption({
  enabled,
  onToggle,
  targetKb = 50,
  onTargetKbChange,
  attachedCount = 0,
  className = '',
  compact = false,
}: ImageCompressionOptionProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border transition-colors ${
        enabled
          ? 'bg-emerald-500/5 border-emerald-500/30 dark:bg-emerald-950/10'
          : 'bg-muted/40 border-border/70'
      } ${className}`}
    >
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
              Compress images for AI (~{targetKb}KB)
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
                  {attachedCount > 0 ? ` (${attachedCount} image${attachedCount > 1 ? 's' : ''} ready)` : ''}
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
  );
}
