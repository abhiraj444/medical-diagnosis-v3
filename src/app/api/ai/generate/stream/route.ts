import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

function parseGoogleErrorMessage(err: any): { message: string; statusCode: number; isFatal: boolean } {
  const raw = err?.message || String(err || '');
  const rawLower = raw.toLowerCase();

  if (rawLower.includes('api_key_invalid') || rawLower.includes('api key not valid') || rawLower.includes('invalid api key')) {
    return {
      message: 'Invalid Google Gemini API Key. Please verify your API key in Settings.',
      statusCode: 401,
      isFatal: true,
    };
  }
  if (rawLower.includes('quota') || rawLower.includes('resource_exhausted') || rawLower.includes('429')) {
    return {
      message: 'Gemini API Rate Limit / Quota Exceeded (429). Please wait a few seconds before trying again.',
      statusCode: 429,
      isFatal: true,
    };
  }
  if (rawLower.includes('permission_denied') || rawLower.includes('403')) {
    return {
      message: 'Gemini API Permission Denied (403). Your API key does not have access to this feature.',
      statusCode: 403,
      isFatal: true,
    };
  }
  if (rawLower.includes('safety') || rawLower.includes('blocked')) {
    return {
      message: 'The AI request was filtered by safety policies. Please clarify the clinical phrasing.',
      statusCode: 422,
      isFatal: true,
    };
  }
  return {
    message: raw.length > 300 ? raw.slice(0, 300) + '...' : raw,
    statusCode: 500,
    isFatal: false,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, images = [], config = {} } = body;

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Prompt is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();

    // 1. Custom Provider Streaming (OpenAI-compatible)
    if (config.provider === 'custom') {
      let endpoint = (config.customEndpoint || '').trim();
      if (!endpoint) {
        return new Response(JSON.stringify({ error: 'Custom LLM endpoint is not configured.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = config.customApiKey || config.apiKey;
      if (key) headers['Authorization'] = `Bearer ${key}`;

      const imageCount = images ? images.filter((i: any) => i.mimeType?.startsWith('image/')).length : 0;
      let augmentedPrompt = prompt;
      if (imageCount > 0) {
        augmentedPrompt = `[CLINICAL ATTACHMENTS: ${imageCount} medical document/image page(s) attached. Inspect and analyze all visible findings, lab parameters, test results, numbers, and clinical text directly from the attached visual image(s).]\n\n${prompt}`;
      }

      const contentParts: any[] = [{ type: 'text', text: augmentedPrompt }];
      if (images && images.length > 0) {
        for (const img of images) {
          if (img.data && img.mimeType?.startsWith('image/')) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            });
          }
        }
      }

      const payload = {
        model: config.customModel || 'gpt-4o',
        messages: [{ role: 'user', content: contentParts.length === 1 ? augmentedPrompt : contentParts }],
        temperature: 0.2,
        stream: true,
      };

      const upstreamRes = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!upstreamRes.ok || !upstreamRes.body) {
        const errText = await upstreamRes.text().catch(() => 'Custom endpoint error');
        let errorMsg = `Custom endpoint error (${upstreamRes.status}): ${errText}`;
        const errLower = errText.toLowerCase();
        if (
          errLower.includes('does not support image') ||
          errLower.includes('only text') ||
          errLower.includes('vision') ||
          errLower.includes('must be a string') ||
          errLower.includes('gptoss120b') ||
          errLower.includes('gpt-oss-120b') ||
          errLower.includes('unprocessable')
        ) {
          errorMsg = `The selected model (${payload.model}) does not support image inputs on OpenRouter. Please select a multimodal/vision model (such as Gemini 2.5 Flash, GPT-4o, Claude 3.7 Sonnet, or Llama 3.2 Vision) in Settings when uploading medical images.`;
        }
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: upstreamRes.status >= 400 && upstreamRes.status < 600 ? upstreamRes.status : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'connected', modelUsed: payload.model })}\n\n`));
          const reader = upstreamRes.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                if (trimmed === 'data: [DONE]') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, modelUsed: payload.model })}\n\n`));
                  continue;
                }
                try {
                  const jsonStr = trimmed.replace(/^data:\s*/, '');
                  const parsed = JSON.parse(jsonStr);
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || '';
                  if (content || reasoning) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ text: content, thinking: reasoning, modelUsed: payload.model })}\n\n`
                      )
                    );
                  }
                } catch {
                  // ignore partial JSON
                }
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, modelUsed: payload.model })}\n\n`));
            controller.close();
          } catch (err: any) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err?.message || 'Stream error' })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Content-Encoding': 'none',
        },
      });
    }

    // 2. Google Gemini Streaming Flow
    const apiKey =
      config.geminiApiKey ||
      config.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Google Gemini API Key is missing. Please set your API key in Settings.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'connected', modelUsed: requestedModel })}\n\n`));
        let streamStarted = false;
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

            let chunksReceived = 0;
            for await (const chunk of responseStream) {
              const candidate = chunk.candidates?.[0];
              const parts = candidate?.content?.parts;

              let text = '';
              let thinking = '';

              if (parts && parts.length > 0) {
                for (const part of parts) {
                  if ((part as any).thought) {
                    thinking += part.text || '';
                  } else if (part.text) {
                    text += part.text;
                  }
                }
              } else if (chunk.text) {
                text = chunk.text;
              }

              if (text || thinking) {
                if (!streamStarted) {
                  streamStarted = true;
                }
                chunksReceived++;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text, thinking, modelUsed: modelName, status: 'streaming' })}\n\n`)
                );
              }
            }

            if (chunksReceived > 0 || streamStarted) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, modelUsed: modelName })}\n\n`));
              controller.close();
              return;
            }
          } catch (err: any) {
            lastError = err;
            const parsedErr = parseGoogleErrorMessage(err);
            console.warn(`Streaming attempt with model ${modelName} failed: ${parsedErr.message}`);
            if (streamStarted || parsedErr.isFatal) {
              // If stream already started or error is fatal (401 invalid key, 429 quota, 403 permission), stop immediately
              break;
            }
            // Otherwise try next fallback model
            continue;
          }
        }

        const { message } = parseGoogleErrorMessage(lastError);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message, done: true })}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Content-Encoding': 'none',
      },
    });
  } catch (error: any) {
    console.error('Unhandled Streaming Route Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Streaming server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
