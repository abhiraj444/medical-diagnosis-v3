'use client';

import React, { useState, useEffect } from 'react';
import {
  Brain,
  Sparkles,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  Layers,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/context/SettingsContext';

export interface ClinicalThinkingBoxProps {
  isLoading: boolean;
  thinkingText?: string;
  streamText?: string;
  currentStep?: string;
  steps?: string[];
  activeStepIndex?: number;
  modelName?: string;
  title?: string;
  defaultExpanded?: boolean;
  className?: string;
  showLiveThinking?: boolean;
  showStreamingOutput?: boolean;
}

export function ClinicalThinkingBox({
  isLoading,
  thinkingText = '',
  streamText = '',
  currentStep = 'Clinical AI Co-Pilot reasoning in progress...',
  steps = [
    'Parsing clinical context & attached documents',
    'Analyzing pathophysiology & clinical differential',
    'Synthesizing structured evidence & slide deck',
  ],
  activeStepIndex = 0,
  modelName = 'Gemini 3.7 Flash Thinking',
  title = 'AI Clinical Reasoning & Progress',
  defaultExpanded = true,
  className = '',
  showLiveThinking,
  showStreamingOutput,
}: ClinicalThinkingBoxProps) {
  const { enableStreamingOutput, enableLiveThinking } = useSettings();
  const allowStreaming = showStreamingOutput !== undefined ? showStreamingOutput : enableStreamingOutput;
  const allowThinking = showLiveThinking !== undefined ? showLiveThinking : enableLiveThinking;

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isLoading) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isLoading]);

  // Don't render anything if not loading and no active output is requested
  if (!isLoading && !thinkingText && !streamText) {
    return null;
  }

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div
      className={`rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-secondary/10 shadow-sm overflow-hidden transition-all duration-300 ${className}`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-1.5 rounded-lg shrink-0 ${
              isLoading
                ? 'bg-primary/20 text-primary animate-pulse'
                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            <Brain className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground truncate">{title}</span>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-mono bg-background border-primary/20 text-primary shrink-0"
              >
                {modelName}
              </Badge>
              {isLoading && (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                  <Activity className="h-3 w-3" />
                  Generating...
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLoading && (
            <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1 bg-background/80 px-2 py-0.5 rounded-md border border-border">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {formatElapsed(elapsedSeconds)}
            </span>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Expandable Body */}
      {isExpanded && (
        <div className="p-4 space-y-3.5 text-xs">
          {/* Step Progress Checklist */}
          {steps.length > 0 && (
            <div className="space-y-1.5 pb-2 border-b border-border/40">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Clinical Workflow Progress
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {steps.map((step, idx) => {
                  const isDone = !isLoading || idx < activeStepIndex;
                  const isCurrent = isLoading && idx === activeStepIndex;
                  return (
                    <div
                      key={step}
                      className={`flex items-center gap-2 p-2 rounded-xl border text-[11px] transition-all ${
                        isCurrent
                          ? 'bg-primary/10 border-primary/30 text-primary font-semibold shadow-xs'
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

          {/* Current Live Stage Status */}
          {isLoading && currentStep && (
            <div className="flex items-center gap-2 text-xs font-medium text-foreground bg-primary/5 p-2.5 rounded-xl border border-primary/15">
              <Sparkles className="h-4 w-4 text-primary shrink-0 animate-spin" />
              <span className="truncate">{currentStep}</span>
            </div>
          )}

          {/* Deep Thinking & Reasoning Log (when flag enabled) */}
          {allowThinking && thinkingText && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  Model Thinking &amp; Reasoning Process
                </span>
                <Badge variant="secondary" className="text-[9px] px-1 font-mono">
                  Internal Chain of Thought
                </Badge>
              </div>
              <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-muted-foreground text-xs leading-relaxed max-h-48 overflow-y-auto font-mono whitespace-pre-wrap select-text">
                {thinkingText}
              </div>
            </div>
          )}

          {/* Live Content Stream Token Preview (when flag enabled) */}
          {allowStreaming && streamText && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-blue-500" />
                  Streaming Output Tokens
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {streamText.length} chars
                </span>
              </div>
              <div className="p-3 rounded-xl bg-background/80 border border-border/70 text-foreground text-xs leading-relaxed max-h-56 overflow-y-auto font-mono whitespace-pre-wrap select-text">
                {streamText}
                {isLoading && <span className="inline-block w-2 h-3.5 bg-primary ml-1 animate-pulse" />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
