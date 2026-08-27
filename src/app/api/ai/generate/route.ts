import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow up to 300s for thinking models (Vercel clamps to plan limit)

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
];

const THINKING_MODELS = ['gemini-3.7-flash', 'gemini-3.1-pro-preview'];

function isThinkingModel(modelName: string): boolean {
  return THINKING_MODELS.some((m) => modelName.toLowerCase().includes(m));
}

function is503Overloaded(err: any): boolean {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('503') || msg.includes('overloaded') || msg.includes('service unavailable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGoogleErrorMessage(err: any): { message: string; statusCode: number; isFatal: boolean } {
  const raw = err?.message || String(err || '');
  const rawLower = raw.toLowerCase();

  if (rawLower.includes('api_key_invalid') || rawLower.includes('api key not valid') || rawLower.includes('invalid api key')) {
    return {
      message: 'Invalid Google Gemini API Key. Please verify your API key in Settings (or check GEMINI_API_KEY in your Vercel Environment Variables).',
      statusCode: 401,
      isFatal: true,
    };
  }

  if (rawLower.includes('quota') || rawLower.includes('resource_exhausted') || rawLower.includes('429') || rawLower.includes('rate limit')) {
    return {
      message: 'Gemini API Rate Limit / Quota Exceeded (429). Please wait a few seconds before trying again or check your billing quota in Google AI Studio.',
      statusCode: 429,
      isFatal: true,
    };
  }

  if (rawLower.includes('permission_denied') || rawLower.includes('403')) {
    return {
      message: 'Gemini API Permission Denied (403). Your API key does not have access to this feature or model.',
      statusCode: 403,
      isFatal: true,
    };
  }

  if (rawLower.includes('not found') || rawLower.includes('404')) {
    return {
      message: `Gemini Model Not Found (404). ${raw}`,
      statusCode: 404,
      isFatal: false,
    };
  }

  if (rawLower.includes('safety') || rawLower.includes('blocked') || rawLower.includes('harm_category')) {
    return {
      message: 'The AI request was filtered by safety policies. Please adjust or clarify the clinical phrasing.',
      statusCode: 422,
      isFatal: true,
    };
  }

  if (rawLower.includes('service unavailable') || rawLower.includes('503') || rawLower.includes('overloaded')) {
    return {
      message: 'Google Gemini service is temporarily overloaded (503). Please retry in a few seconds.',
      statusCode: 503,
      isFatal: false,
    };
  }

  return {
    message: raw.length > 300 ? raw.slice(0, 300) + '...' : raw,
    statusCode: 500,
    isFatal: false,
  };
}

/**
 * Transcribe audio via Groq's dedicated Whisper endpoint.
 * Returns the transcript text, or null if transcription fails.
 */
async function transcribeAudioViaGroq(
  audioBase64: string,
  audioMimeType: string,
  apiKey: string,
  baseEndpoint: string
): Promise<string | null> {
  try {
    // Derive the transcription endpoint from the base endpoint
    let transcriptionUrl = baseEndpoint.replace(/\/+$/, '');
    // Strip /chat/completions if present
    transcriptionUrl = transcriptionUrl.replace(/\/chat\/completions$/, '');
    transcriptionUrl += '/audio/transcriptions';

    // Convert base64 to binary
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Determine file extension from mime type
    const extMap: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
    };
    const ext = extMap[audioMimeType] || 'webm';

    // Create FormData with the audio file
    const formData = new FormData();
    const blob = new Blob([bytes], { type: audioMimeType });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');

    const res = await fetch(transcriptionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      console.warn(`Groq Whisper transcription failed (${res.status}):`, await res.text());
      return null;
    }

    const data = await res.json();
    return data.text || null;
  } catch (err) {
    console.warn('Audio transcription failed:', err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, images = [], config = {} } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required and must be a text string.' }, { status: 400 });
    }

    // --- 1. Custom Provider Flow (OpenAI / OpenRouter / Groq / DeepSeek / Ollama) ---
    if (config.provider === 'custom') {
      let endpoint = (config.customEndpoint || '').trim();
      if (!endpoint) {
        return NextResponse.json(
          { error: 'Custom LLM endpoint is not configured. Please set your endpoint URL in Settings.' },
          { status: 400 }
        );
      }

      if (!endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const key = config.customApiKey || config.apiKey;
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }

      // Detect if this is a Groq endpoint for special audio handling
      const isGroqEndpoint = endpoint.toLowerCase().includes('groq.com');
      const imageCount = images ? images.filter((i) => i.mimeType?.startsWith('image/')).length : 0;

      // Process media: transcribe audio for providers that don't support inline audio
      let augmentedPrompt = prompt;
      if (imageCount > 0) {
        augmentedPrompt = `[CLINICAL ATTACHMENTS: ${imageCount} medical document/image page(s) attached. Inspect and analyze all visible findings, lab parameters, test results, numbers, waveforms, patient info, and clinical text directly from the attached visual image(s).]\n\n${prompt}`;
      }

      const contentParts: any[] = [{ type: 'text', text: '' }]; // text placeholder, will be set later

      if (images && images.length > 0) {
        for (const img of images) {
          if (!img.data) continue;

          if (img.mimeType.startsWith('image/')) {
            // Images: standard image_url format (works for Groq vision models, OpenAI, etc.)
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${img.mimeType};base64,${img.data}`,
              },
            });
          } else if (img.mimeType.startsWith('audio/')) {
            // Audio attachment: transcribe via Whisper or Groq if possible, and inject into prompt text
            // Avoid sending raw 'input_audio' to providers that only support text/vision to prevent 400 Bad Request errors
            let transcriptText: string | null = null;
            if (key) {
              transcriptText = await transcribeAudioViaGroq(img.data, img.mimeType, key, endpoint);
            }
            if (transcriptText) {
              augmentedPrompt = `[Audio Transcript from clinical voice memo]:\n"${transcriptText}"\n\n${augmentedPrompt}`;
            } else {
              augmentedPrompt = `[Spoken voice memo was recorded and attached as optional context. Please analyze based on the clinical text and visual findings.]\n\n${augmentedPrompt}`;
            }
          } else if (img.mimeType === 'application/pdf') {
            // PDFs: most custom providers don't support inline PDFs
            augmentedPrompt = `[PDF document was attached. If you can process the document content from the provided data, please analyze it. Otherwise, focus on the text input.]\n\n${augmentedPrompt}`;
          }
        }
      }

      // Set the text content part with the (potentially augmented) prompt
      contentParts[0].text = augmentedPrompt;

      // Auto-select a vision-capable model on Groq if images are attached and current model is text-only
      let initialModel = config.customModel || 'gpt-4o';
      if (imageCount > 0 && isGroqEndpoint) {
        const isKnownGroqVision = initialModel.includes('vision') || initialModel.includes('qwen');
        if (!isKnownGroqVision) {
          console.log(`Auto-routing Groq request with images from ${initialModel} to llama-3.2-11b-vision-preview`);
          initialModel = 'llama-3.2-11b-vision-preview';
        }
      }

      const payload = {
        model: initialModel,
        messages: [
          {
            role: 'user',
            content: contentParts.length === 1 ? augmentedPrompt : contentParts,
          },
        ],
        temperature: 0.2,
      };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => 'Unknown error');
          const errLower = errText.toLowerCase();

          // If multimodal was rejected on Groq, attempt secondary vision models
          if (contentParts.length > 1 && isGroqEndpoint) {
            const alternateGroqModels = ['llama-3.2-11b-vision-preview', 'qwen/qwen3.6-27b', 'llama-3.2-90b-vision-preview'].filter(
              (m) => m !== initialModel
            );

            for (const altModel of alternateGroqModels) {
              console.warn(`Groq vision retry with alternate model ${altModel}...`);
              const altPayload = { ...payload, model: altModel };
              const altRes = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(altPayload),
              });
              if (altRes.ok) {
                const data = await altRes.json();
                return NextResponse.json({ text: data.choices?.[0]?.message?.content || '' });
              }
            }
          }

          let parsedMsg = errText;
          try {
            const errJson = JSON.parse(errText);
            parsedMsg = errJson.error?.message || errJson.message || errText;
          } catch {
            // keep raw text
          }

          // Provide helpful guidance for common custom provider errors
          let userHint = '';
          if (
            errLower.includes('does not support image') ||
            errLower.includes('only text') ||
            errLower.includes('vision') ||
            errLower.includes('must be a string') ||
            errLower.includes('unprocessable')
          ) {
            userHint =
              ' Tip: This model does not support image inputs. Try selecting a vision-capable model (e.g. Gemini 3.7 Flash, Llama 3.2 Vision, or GPT-4o) in Settings to analyze medical images.';
          }

          return NextResponse.json(
            { error: `Custom AI Endpoint Error (${res.status}): ${parsedMsg.slice(0, 300)}${userHint}` },
            { status: res.status >= 400 && res.status < 600 ? res.status : 500 }
          );
        }

        const data = await res.json();
        const replyText = data.choices?.[0]?.message?.content || '';
        return NextResponse.json({ text: replyText });
      } catch (fetchErr: any) {
        return NextResponse.json(
          {
            error: `Failed to connect to custom AI endpoint (${endpoint}): ${fetchErr?.message || 'Network error'}`,
          },
          { status: 502 }
        );
      }
    }

    // --- 2. Google Gemini Provider Flow (with Streaming + Retry) ---
    const apiKey =
      config.geminiApiKey ||
      config.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Google Gemini API Key is missing. Please set your API key in Settings (or set GEMINI_API_KEY in your Vercel Project Environment Variables).',
        },
        { status: 400 }
      );
    }

    const requestedModel = config.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.7-flash';
    const modelsToTry = [requestedModel, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== requestedModel)];

    const validImages = images ? images.filter((img: any) => img && img.data && typeof img.data === 'string' && img.data.length > 50) : [];
    const imageCount = validImages.filter((img: any) => img.mimeType?.startsWith('image/')).length;

    let effectivePrompt = prompt;
    if (imageCount > 0) {
      effectivePrompt = `[CLINICAL ATTACHMENTS: ${imageCount} medical document/image page(s) attached. Thoroughly examine and extract all visible findings, lab test parameters, numerical values, reference ranges, patient demographics, and clinical text directly from the attached visual image(s) to formulate the comprehensive response.]\n\n${prompt}`;
    }

    const contents: any[] = [];
    if (validImages.length > 0) {
      for (const img of validImages) {
        contents.push({
          inlineData: {
            data: img.data,
            mimeType: img.mimeType || 'image/jpeg',
          },
        });
      }
    }
    contents.push({ text: effectivePrompt });

    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        const genConfig: any = {};
        if (isThinkingModel(modelName)) {
          const userBudget = config.thinkingBudget;
          if (userBudget === 0) {
            genConfig.thinkingConfig = { thinkingBudget: 0 };
          } else if (typeof userBudget === 'number' && userBudget > 0) {
            genConfig.thinkingConfig = { thinkingBudget: userBudget };
          }
        }

        const responseStream = await ai.models.generateContentStream({
          model: modelName,
          contents,
          config: Object.keys(genConfig).length > 0 ? genConfig : undefined,
        });

        let fullText = '';
        let fullThought = '';

        for await (const chunk of responseStream) {
          const candidate = chunk.candidates?.[0];
          const parts = candidate?.content?.parts;

          if (parts && parts.length > 0) {
            for (const part of parts) {
              if (part.thought) {
                fullThought += part.text || '';
              } else if (part.text) {
                fullText += part.text;
              }
            }
          } else if (chunk.text) {
            fullText += chunk.text;
          }
        }

        if (fullText.trim().length > 0) {
          return NextResponse.json({
            text: fullText,
            thought: fullThought || undefined,
            modelUsed: modelName,
          });
        }
      } catch (err: any) {
        lastError = err;
        const parsedErr = parseGoogleErrorMessage(err);
        console.warn(`Model ${modelName} encountered error: ${parsedErr.message}`);
        if (parsedErr.isFatal) {
          // If error is fatal (401, 429, 403, 422), do not hammer remaining models
          break;
        }
        // Otherwise attempt fallback model
        continue;
      }
    }

    const { message, statusCode } = parseGoogleErrorMessage(lastError);
    return NextResponse.json(
      {
        error: message,
        rawError: lastError?.message || String(lastError || ''),
      },
      { status: statusCode }
    );
  } catch (error: any) {
    console.error('Unhandled AI API Route Error:', error);
    return NextResponse.json(
      {
        error: error?.message || 'An unexpected internal error occurred while processing the clinical question.',
      },
      { status: 500 }
    );
  }
}
