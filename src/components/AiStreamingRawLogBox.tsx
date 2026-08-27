'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Brain,
  Sparkles,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  FileText,
  Copy,
  Check,
  Square,
  Terminal,
  ArrowDownCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/context/SettingsContext';
import { formatModelDisplayName } from '@/lib/ClientSideAiService';

export interface AiStreamingRawLogBoxProps {
  isLoading?: boolean;
  isStreaming?: boolean;
  streamText?: string;
  thinkingText?: string;
  thought?: string;
  currentStep?: string;
  steps?: string[];
  activeStepIndex?: number;
  modelName?: string;
  title?: string;
  onStop?: () => void;
  defaultExpanded?: boolean;
  className?: string;
  compact?: boolean;
}

export function AiStreamingRawLogBox({
  isLoading,
  isStreaming,
  streamText = '',
  thinkingText = '',
  thought = '',
  currentStep = 'AI processing request...',
  steps = [],
  activeStepIndex = 0,
  modelName,
  title = 'AI Live Stream & Diagnostics',
  onStop,
  defaultExpanded = true,
  className = '',
  compact = false,
}: AiStreamingRawLogBoxProps) {
  const { activeModel, aiConfig } = useSettings();
  const effectiveLoading = isLoading !== undefined ? isLoading : (isStreaming !== undefined ? isStreaming : false);
  const effectiveThinking = thinkingText || thought || '';

  const effectiveModelName = modelName
    ? formatModelDisplayName(modelName)
    : formatModelDisplayName(activeModel || aiConfig?.customModel || aiConfig?.geminiModel || 'Gemini');

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const streamScrollRef = useRef<HTMLDivElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);

  // Timer while loading
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (effectiveLoading) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [effectiveLoading]);

  // Auto-scroll when new text arrives
  useEffect(() => {
    if (autoScroll && streamScrollRef.current && isExpanded) {
      streamScrollRef.current.scrollTop = streamScrollRef.current.scrollHeight;
    }
  }, [streamText, autoScroll, isExpanded]);

  useEffect(() => {
    if (autoScroll && thinkingScrollRef.current && isExpanded) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
    }
  }, [effectiveThinking, autoScroll, isExpanded]);

  // Automatically expand when generation starts
  useEffect(() => {
    if (effectiveLoading) {
      setIsExpanded(true);
    }
  }, [effectiveLoading]);

  // If not loading and no content received yet, do not render
  if (!effectiveLoading && !effectiveThinking && !streamText) {
    return null;
  }

  const handleCopy = () => {
    const fullContent = [
      effectiveThinking ? `--- THINKING PROCESS ---\n${effectiveThinking}` : '',
      streamText ? `--- RAW OUTPUT ---\n${streamText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (fullContent) {
      navigator.clipboard.writeText(fullContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s < 10 ? '0' : ''}${s}s` : `${s}s`;
  };

  const charCount = streamText.length;
  const estimatedTokens = Math.round(charCount / 4);

  return (
    <div
      id="ai-streaming-raw-log-box"
      className={`rounded-2xl border border-primary/25 bg-card shadow-md overflow-hidden transition-all duration-300 ${
        effectiveLoading ? 'ring-1 ring-primary/30 shadow-primary/5' : ''
      } ${className}`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/40 border-b border-border/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-1.5 rounded-lg shrink-0 transition-colors ${
              effectiveLoading
                ? 'bg-primary/20 text-primary animate-pulse'
                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {effectiveLoading ? (
              <Terminal className="h-4 w-4 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-foreground truncate">{title}</span>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-mono bg-background/80 border-primary/20 text-primary shrink-0"
              >
                {effectiveModelName}
              </Badge>
              {effectiveLoading ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                  <Activity className="h-3 w-3" />
                  Streaming Live...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  Completed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {effectiveLoading && (
            <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1 bg-background px-2 py-0.5 rounded-md border border-border">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {formatElapsed(elapsedSeconds)}
            </span>
          )}

          {charCount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline-flex bg-background px-1.5 py-0.5 rounded border border-border/60">
              {charCount} chars (~{estimatedTokens} tok)
            </span>
          )}

          {(streamText || effectiveThinking) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Copy Raw Stream & Reasoning"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          )}

          {effectiveLoading && onStop && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onStop}
              className="h-7 px-2 text-[11px] font-semibold gap-1 shrink-0"
              title="Stop AI Generation"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title={isExpanded ? 'Collapse Raw Stream' : 'Expand Raw Stream'}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Expandable Body */}
      {isExpanded && (
        <div className="p-3.5 space-y-3 text-xs bg-background/60">
          {/* Step Progress Checklist if steps provided */}
          {steps.length > 0 && (
            <div className="space-y-1.5 pb-2 border-b border-border/40">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Clinical Synthesis Steps
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {steps.map((step, idx) => {
                  const isDone = !effectiveLoading || idx < activeStepIndex;
                  const isCurrent = effectiveLoading && idx === activeStepIndex;
                  return (
                    <div
                      key={step}
                      className={`flex items-center gap-2 p-2 rounded-xl border text-[11px] transition-all ${
                        isCurrent
                          ? 'bg-primary/10 border-primary/30 text-primary font-semibold shadow-2xs'
                          : isDone
                          ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                          : 'bg-muted/30 border-border/40 text-muted-foreground'
                      }`}
                    >
                      {isDone && !isCurrent ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : isCurrent ? (
                        <div className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />
                      )}
                      <span className="truncate">{step}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Current Active Status */}
          {effectiveLoading && currentStep && (
            <div className="flex items-center gap-2 text-xs font-medium text-foreground bg-primary/5 p-2.5 rounded-xl border border-primary/15">
              <Sparkles className="h-4 w-4 text-primary shrink-0 animate-spin" />
              <span className="truncate">{currentStep}</span>
            </div>
          )}

          {/* Model Thinking / Chain of Thought */}
          {effectiveThinking && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  Model Thinking &amp; Reasoning Process
                </span>
                <Badge variant="secondary" className="text-[9px] px-1 font-mono">
                  Chain of Thought
                </Badge>
              </div>
              <div
                ref={thinkingScrollRef}
                className="p-2.5 rounded-xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 text-foreground/80 text-[11px] leading-relaxed max-h-36 overflow-y-auto font-mono whitespace-pre-wrap select-text"
              >
                {effectiveThinking}
              </div>
            </div>
          )}

          {/* Raw Text Stream Box */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-blue-500" />
                Raw Text Streaming Output (Live)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                    autoScroll
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted border-border text-muted-foreground'
                  }`}
                  title="Toggle auto-scroll to latest tokens"
                >
                  <ArrowDownCircle className="h-2.5 w-2.5" />
                  Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
                </button>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {charCount} chars
                </span>
              </div>
            </div>

            <div
              ref={streamScrollRef}
              className={`p-3 rounded-xl bg-neutral-950 text-neutral-100 border border-neutral-800 text-[11px] leading-relaxed font-mono whitespace-pre-wrap select-text overflow-y-auto ${
                compact ? 'max-h-44' : 'max-h-60'
              }`}
            >
              {streamText || (
                <span className="text-neutral-500 italic">
                  {effectiveLoading ? 'Waiting for first stream token from model...' : 'No stream output recorded.'}
                </span>
              )}
              {effectiveLoading && (
                <span className="inline-block w-2 h-3.5 bg-emerald-400 ml-1 animate-pulse align-middle" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AiStreamingRawLogBox;
