import type { DiagnosisItem, ClinicalAnswerData, Slide, ReportKnowledgeData, ContentItem } from '@/types';

/**
 * Repairs truncated or partial JSON strings by closing unclosed quotes, brackets, and braces.
 */
export function repairJsonString(jsonStr: string): string {
  let text = jsonStr.trim();
  if (!text) return '{}';

  // Remove markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '');
    const endFence = text.lastIndexOf('```');
    if (endFence !== -1) {
      text = text.substring(0, endFence).trim();
    }
  }

  // Remove trailing commas before closing braces/brackets
  text = text.replace(/,\s*([\]}])/g, '$1');

  // Count unclosed quotes, braces, brackets
  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\\' && inString) {
      isEscaped = !isEscaped;
      continue;
    }

    if (char === '"' && !isEscaped) {
      inString = !inString;
      continue;
    }

    isEscaped = false;

    if (!inString) {
      if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}' || char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === char) {
          stack.pop();
        }
      }
    }
  }

  // If ended inside a string, close it
  if (inString) {
    text += '"';
  }

  // Clean trailing commas that might have been left at the end before closing
  text = text.replace(/,\s*$/, '');

  // Close remaining unclosed brackets in reverse
  while (stack.length > 0) {
    const closingChar = stack.pop();
    text += closingChar;
  }

  return text;
}

/**
 * Universal robust JSON parser that handles codeblocks, bracket extraction,
 * trailing commas, escaped characters, and structural un-nesting.
 */
export function parseAiJson<T>(rawText: string, fallback: T): T {
  if (!rawText || typeof rawText !== 'string') return fallback;

  const cleaned = rawText.trim();

  // 1. Direct parse attempt
  try {
    const parsed = JSON.parse(cleaned);
    return unwrapExpected(parsed, fallback);
  } catch {}

  // 2. Extract from markdown code fence ```json ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const blockContent = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      return unwrapExpected(parsed, fallback);
    } catch {
      try {
        const repaired = repairJsonString(blockContent);
        const parsed = JSON.parse(repaired);
        return unwrapExpected(parsed, fallback);
      } catch {}
    }
  }

  // 3. Extract bracket contents
  const bracketMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (bracketMatch && bracketMatch[0]) {
    try {
      let jsonText = bracketMatch[0];
      // Clean invalid control characters
      jsonText = jsonText.replace(/[\u0000-\u001F\u007F-\u009F]/g, (c) => (c === '\n' || c === '\r' || c === '\t' ? c : ' '));
      const parsed = JSON.parse(jsonText);
      return unwrapExpected(parsed, fallback);
    } catch {
      try {
        const repaired = repairJsonString(bracketMatch[0]);
        const parsed = JSON.parse(repaired);
        return unwrapExpected(parsed, fallback);
      } catch {}
    }
  }

  // 4. Try repairing the entire raw text
  try {
    const repaired = repairJsonString(cleaned);
    const parsed = JSON.parse(repaired);
    return unwrapExpected(parsed, fallback);
  } catch {}

  return fallback;
}

/**
 * Unwraps nested top-level keys if the caller expected an array or specific structure
 * (e.g., { slides: [...] } when caller expected [...])
 */
function unwrapExpected<T>(parsed: any, fallback: T): T {
  if (parsed === null || parsed === undefined) return fallback;

  if (Array.isArray(fallback)) {
    if (Array.isArray(parsed)) {
      return parsed as unknown as T;
    }
    if (typeof parsed === 'object') {
      if (Array.isArray(parsed.slides)) return parsed.slides as unknown as T;
      if (Array.isArray(parsed.diagnoses)) return parsed.diagnoses as unknown as T;
      if (Array.isArray(parsed.outline)) return parsed.outline as unknown as T;
      if (Array.isArray(parsed.topics)) return parsed.topics as unknown as T;
      if (Array.isArray(parsed.items)) return parsed.items as unknown as T;
      if (Array.isArray(parsed.data)) return parsed.data as unknown as T;
    }
  }

  return parsed as T;
}

/**
 * Extracts progressive Diagnosis objects from a streaming JSON string as they complete.
 */
export function extractProgressiveDiagnosis(rawText: string): {
  summary?: string;
  diagnoses: DiagnosisItem[];
  clinicalAnswer?: Partial<ClinicalAnswerData>;
  proactiveQuestions: string[];
  reportKnowledge?: ReportKnowledgeData | null;
  caseSummaryForPresentation?: string;
} {
  const result: {
    summary?: string;
    diagnoses: DiagnosisItem[];
    clinicalAnswer?: Partial<ClinicalAnswerData>;
    proactiveQuestions: string[];
    reportKnowledge?: ReportKnowledgeData | null;
    caseSummaryForPresentation?: string;
  } = {
    diagnoses: [],
    proactiveQuestions: [],
  };

  if (!rawText || rawText.trim().length === 0) return result;

  // Try parsing partial or full JSON with repair
  try {
    const parsed = parseAiJson<any>(rawText, null);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        result.summary = parsed.summary.trim();
      }
      if (typeof parsed.caseSummaryForPresentation === 'string' && parsed.caseSummaryForPresentation.trim()) {
        result.caseSummaryForPresentation = parsed.caseSummaryForPresentation.trim();
      }

      if (Array.isArray(parsed.diagnoses) && parsed.diagnoses.length > 0) {
        result.diagnoses = parsed.diagnoses
          .filter((d: any) => d && typeof d === 'object' && (d.diagnosis || d.condition))
          .map((d: any, idx: number) => ({
            diagnosis: d.diagnosis || d.condition || `Differential #${idx + 1}`,
            confidenceLevel: typeof d.confidenceLevel === 'number' ? d.confidenceLevel : 0.8,
            lifeThreatCategory: d.lifeThreatCategory || 'Emergent',
            reasoning: d.reasoning || d.rationale || '',
            missingInformation: {
              information: Array.isArray(d.missingInformation?.information) ? d.missingInformation.information : [],
              tests: Array.isArray(d.missingInformation?.tests) ? d.missingInformation.tests : [],
            },
          }));
      }

      if (parsed.clinicalAnswer && typeof parsed.clinicalAnswer === 'object') {
        result.clinicalAnswer = {
          answer: parsed.clinicalAnswer.answer || '',
          reasoning: parsed.clinicalAnswer.reasoning || '',
          topic: parsed.clinicalAnswer.topic || '',
          keyTakeaways: Array.isArray(parsed.clinicalAnswer.keyTakeaways) ? parsed.clinicalAnswer.keyTakeaways : [],
        };
      }

      if (Array.isArray(parsed.proactiveQuestions) && parsed.proactiveQuestions.length > 0) {
        result.proactiveQuestions = parsed.proactiveQuestions.filter((q: any) => typeof q === 'string' && q.trim().length > 0);
      }

      if (parsed.reportKnowledge && parsed.reportKnowledge.categories && Array.isArray(parsed.reportKnowledge.categories)) {
        result.reportKnowledge = parsed.reportKnowledge;
      }
    }
  } catch (e) {
    // If structured parse fails, attempt regex extraction for partial streaming
  }

  // Regex fallback for progressive partial extraction if JSON parse returned empty
  if (result.diagnoses.length === 0) {
    const diagBlocks = rawText.matchAll(/\{\s*"diagnosis"\s*:\s*"([^"]+)"[\s\S]*?"reasoning"\s*:\s*"([^"]+)"/g);
    for (const match of diagBlocks) {
      if (match[1] && match[2]) {
        result.diagnoses.push({
          diagnosis: match[1],
          confidenceLevel: 0.85,
          lifeThreatCategory: 'Emergent',
          reasoning: match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
          missingInformation: { information: [], tests: [] },
        });
      }
    }
  }

  return result;
}

/**
 * Extracts completed Slide objects from a streaming JSON string as they are generated.
 */
export function extractProgressiveSlides(rawText: string): Slide[] {
  if (!rawText || rawText.trim().length === 0) return [];

  // Try parsing full/repaired JSON
  try {
    const parsed = parseAiJson<any>(rawText, null);
    const slidesArray = Array.isArray(parsed) ? parsed : parsed?.slides;

    if (Array.isArray(slidesArray) && slidesArray.length > 0) {
      const validSlides: Slide[] = [];
      for (const s of slidesArray) {
        if (s && typeof s === 'object' && s.title) {
          validSlides.push({
            title: s.title,
            content: Array.isArray(s.content) ? sanitizeContentItems(s.content) : [],
            summary: typeof s.summary === 'string' ? s.summary : '',
            clinicalPearls: Array.isArray(s.clinicalPearls) ? s.clinicalPearls : [],
            proactiveQuestions: Array.isArray(s.proactiveQuestions) ? s.proactiveQuestions : [],
          });
        }
      }
      if (validSlides.length > 0) return validSlides;
    }
  } catch {}

  // Fallback: extract individual completed slide JSON objects via regex
  const completedSlides: Slide[] = [];
  const slideRegex = /\{\s*"title"\s*:\s*"([^"]+)"[\s\S]*?"content"\s*:\s*\[([\s\S]*?)\][\s\S]*?\}(?=\s*,|\s*\]|$)/g;
  let match;

  while ((match = slideRegex.exec(rawText)) !== null) {
    try {
      const slideObjStr = match[0];
      const repaired = repairJsonString(slideObjStr);
      const s = JSON.parse(repaired);
      if (s && s.title) {
        completedSlides.push({
          title: s.title,
          content: Array.isArray(s.content) ? sanitizeContentItems(s.content) : [],
          summary: typeof s.summary === 'string' ? s.summary : '',
          clinicalPearls: Array.isArray(s.clinicalPearls) ? s.clinicalPearls : [],
          proactiveQuestions: Array.isArray(s.proactiveQuestions) ? s.proactiveQuestions : [],
        });
      }
    } catch {}
  }

  return completedSlides;
}

/**
 * Sanitizes slide content items to ensure valid schema
 */
function sanitizeContentItems(items: any[]): ContentItem[] {
  const result: ContentItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'paragraph' && item.text) {
      result.push({
        type: 'paragraph',
        text: item.text,
        bold: Array.isArray(item.bold) ? item.bold : [],
      });
    } else if (item.type === 'bullet_list' && Array.isArray(item.items)) {
      result.push({
        type: 'bullet_list',
        items: item.items.map((i: any) => ({
          text: typeof i === 'string' ? i : i.text || '',
          bold: Array.isArray(i.bold) ? i.bold : [],
        })),
      });
    } else if (item.type === 'numbered_list' && Array.isArray(item.items)) {
      result.push({
        type: 'numbered_list',
        items: item.items.map((i: any) => ({
          text: typeof i === 'string' ? i : i.text || '',
          bold: Array.isArray(i.bold) ? i.bold : [],
        })),
      });
    } else if (item.type === 'table' && Array.isArray(item.headers)) {
      result.push({
        type: 'table',
        headers: item.headers,
        rows: Array.isArray(item.rows)
          ? item.rows.map((r: any) => ({
              cells: Array.isArray(r.cells) ? r.cells : Array.isArray(r) ? r : [],
            }))
          : [],
      });
    } else if (item.type === 'note' && item.text) {
      result.push({
        type: 'note',
        text: item.text,
      });
    }
  }

  return result;
}

/**
 * Progressive Clinical Answer Parser for Clinical Questions
 */
export function extractProgressiveClinicalAnswer(rawText: string): {
  answer: string;
  reasoning?: string;
  topic?: string;
  keyTakeaways: string[];
  proactiveQuestions: string[];
} {
  const result = {
    answer: '',
    reasoning: '',
    topic: '',
    keyTakeaways: [] as string[],
    proactiveQuestions: [] as string[],
  };

  if (!rawText || rawText.trim().length === 0) return result;

  try {
    const parsed = parseAiJson<any>(rawText, null);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.answer === 'string') result.answer = parsed.answer;
      if (typeof parsed.reasoning === 'string') result.reasoning = parsed.reasoning;
      if (typeof parsed.topic === 'string') result.topic = parsed.topic;
      if (Array.isArray(parsed.keyTakeaways)) result.keyTakeaways = parsed.keyTakeaways;
      if (Array.isArray(parsed.proactiveQuestions)) result.proactiveQuestions = parsed.proactiveQuestions;

      if (result.answer) return result;
    }
  } catch {}

  // Fallback: If it's pure markdown streaming text without JSON structure
  const trimmed = rawText.trim();
  const isJsonLike =
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('```json') ||
    trimmed.startsWith('```\n[') ||
    trimmed.startsWith('```\n{') ||
    trimmed.includes('"title":') ||
    trimmed.includes('"content":');

  if (!isJsonLike) {
    result.answer = rawText;
  }

  return result;
}
