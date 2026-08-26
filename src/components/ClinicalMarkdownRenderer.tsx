'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ClinicalMarkdownRendererProps {
  content: string | null | undefined;
  className?: string;
}

/**
 * Sanitizes markdown content:
 * - Detects if the string is wrapped in JSON or markdown code block (e.g. ````json { "answer": "..." } ````)
 * - Decodes literal escaped newlines ("\\n" -> "\n")
 * - Cleans up escaped quotes ("\\\"" -> "\"")
 * - Trims unnecessary leading/trailing artifacts
 */
export function sanitizeClinicalMarkdown(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw.trim();

  // Check if text is a JSON code block containing an "answer" or "text" or "clinicalAnswer" field
  const jsonBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed.answer && typeof parsed.answer === 'string') {
        text = parsed.answer;
      } else if (parsed.clinicalAnswer?.answer && typeof parsed.clinicalAnswer.answer === 'string') {
        text = parsed.clinicalAnswer.answer;
      } else if (parsed.summary && typeof parsed.summary === 'string') {
        text = parsed.summary;
      }
    } catch {
      // If full JSON parse failed, try extracting the answer property value via regex
      const answerRegexMatch = jsonBlockMatch[1].match(/"answer"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"\w+"|\s*\})/);
      if (answerRegexMatch) {
        text = answerRegexMatch[1];
      }
    }
  }

  // Check if text is a raw JSON string like { "answer": "..." }
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.answer && typeof parsed.answer === 'string') {
        text = parsed.answer;
      } else if (parsed.clinicalAnswer?.answer && typeof parsed.clinicalAnswer.answer === 'string') {
        text = parsed.clinicalAnswer.answer;
      }
    } catch {
      const answerRegexMatch = text.match(/"answer"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"\w+"|\s*\})/);
      if (answerRegexMatch) {
        text = answerRegexMatch[1];
      }
    }
  }

  // Handle literal escaped newlines and tabs
  if (text.includes('\\n')) {
    text = text.replace(/\\n/g, '\n');
  }
  if (text.includes('\\t')) {
    text = text.replace(/\\t/g, '\t');
  }
  if (text.includes('\\"')) {
    text = text.replace(/\\"/g, '"');
  }

  // If text still starts with ```markdown or ```, remove them
  if (text.startsWith('```markdown')) {
    text = text.replace(/^```markdown\s*/, '').replace(/\s*```$/, '');
  } else if (text.startsWith('```') && !text.includes('\n```\n')) {
    text = text.replace(/^```\w*\s*/, '').replace(/\s*```$/, '');
  }

  return text.trim();
}

export function ClinicalMarkdownRenderer({
  content,
  className = '',
}: ClinicalMarkdownRendererProps) {
  const sanitized = useMemo(() => sanitizeClinicalMarkdown(content), [content]);

  if (!sanitized) {
    return null;
  }

  return (
    <div className={`clinical-markdown prose prose-sm dark:prose-invert max-w-none leading-relaxed break-words font-sans ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className="text-lg sm:text-xl font-bold text-foreground mt-4 mb-2 pb-1.5 border-b border-border/80 flex items-center gap-2"
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className="text-base sm:text-lg font-bold text-foreground mt-4 mb-2 pb-1 border-b border-border/60"
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className="text-sm sm:text-base font-bold text-primary dark:text-primary mt-3 mb-1.5 flex items-center gap-1.5"
              {...props}
            />
          ),
          h4: ({ node, ...props }) => (
            <h4
              className="text-xs sm:text-sm font-semibold text-foreground mt-2 mb-1 uppercase tracking-wide"
              {...props}
            />
          ),
          p: ({ node, ...props }) => (
            <p className="text-xs sm:text-sm text-foreground/90 my-2 leading-relaxed" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-2 ml-4 list-disc space-y-1 text-xs sm:text-sm text-foreground/90" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-2 ml-4 list-decimal space-y-1 text-xs sm:text-sm text-foreground/90" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed pl-0.5" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-bold text-foreground" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="my-3 pl-3.5 py-1 border-l-3 border-primary/70 bg-primary/5 dark:bg-primary/10 rounded-r-lg text-xs sm:text-sm text-foreground/80 italic"
              {...props}
            />
          ),
          table: ({ node, ...props }) => (
            <div className="my-3 w-full overflow-x-auto rounded-xl border border-border bg-card shadow-2xs">
              <table className="w-full text-left text-xs border-collapse divide-y divide-border" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead className="bg-muted/70 text-foreground font-semibold uppercase tracking-wider text-[11px]" {...props} />
          ),
          tbody: ({ node, ...props }) => (
            <tbody className="divide-y divide-border/60 bg-background/50" {...props} />
          ),
          tr: ({ node, ...props }) => (
            <tr className="hover:bg-muted/30 transition-colors" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th className="px-3.5 py-2.5 font-bold text-foreground border-r last:border-r-0 border-border/60" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="px-3.5 py-2 text-foreground/90 border-r last:border-r-0 border-border/40 align-top" {...props} />
          ),
          code: ({ node, className, children, ...props }) => {
            const isInline = !className && typeof children === 'string';
            if (isInline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-primary border border-border/60" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="my-2.5 overflow-x-auto rounded-xl bg-muted/70 p-3 font-mono text-xs text-foreground border border-border">
                <code {...props}>{children}</code>
              </pre>
            );
          },
          hr: () => <hr className="my-4 border-border/80" />,
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}
