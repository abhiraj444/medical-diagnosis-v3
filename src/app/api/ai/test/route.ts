import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
  'gemini-1.5-flash',
  'gemini-2.0-flash',
];

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await req.json();
    const { config = {} } = body;

    if (config.provider === 'custom') {
      let endpoint = (config.customEndpoint || '').trim();
      if (!endpoint) {
        return NextResponse.json({
          success: false,
          message: 'Custom LLM endpoint is empty. Please enter your endpoint URL.',
          latencyMs: Date.now() - startTime,
        });
      }

      if (!endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = config.customApiKey || config.apiKey;
      if (key) headers['Authorization'] = `Bearer ${key}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.customModel || 'gpt-4o',
          messages: [{ role: 'user', content: 'Respond with "READY"' }],
        }),
      });

      const latencyMs = Date.now() - startTime;
      if (!res.ok) {
        const txt = await res.text();
        return NextResponse.json({
          success: false,
          message: `Custom Endpoint returned HTTP ${res.status}: ${txt.slice(0, 200)}`,
          latencyMs,
          modelUsed: config.customModel || 'Custom',
        });
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || 'READY';
      return NextResponse.json({
        success: true,
        message: `Connected successfully (${latencyMs}ms): ${text.trim().slice(0, 50)}`,
        latencyMs,
        modelUsed: config.customModel || 'Custom',
      });
    }

    // Gemini
    const apiKey =
      config.geminiApiKey ||
      config.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        message: 'No Google Gemini API key found in Settings or server environment.',
        latencyMs: Date.now() - startTime,
        modelUsed: config.geminiModel || 'gemini-3.7-flash',
      });
    }

    const requestedModel = config.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.7-flash';
    const modelsToTry = [requestedModel, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== requestedModel)];

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    let lastError: any = null;
    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: 'Respond with "READY"',
        });

        const latencyMs = Date.now() - startTime;
        const responseText = response.text?.trim() || 'READY';

        return NextResponse.json({
          success: true,
          message: `Connection successful (${latencyMs}ms): ${responseText.slice(0, 50)}`,
          latencyMs,
          modelUsed: modelName,
        });
      } catch (err: any) {
        lastError = err;
        console.warn(`Test route model ${modelName} failed, trying fallback...`, err?.message);
        continue;
      }
    }

    return NextResponse.json({
      success: false,
      message: lastError?.message || 'Connection test failed across all Gemini models.',
      latencyMs: Date.now() - startTime,
      modelUsed: requestedModel,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      message: err?.message || 'Connection test failed.',
      latencyMs: Date.now() - startTime,
      modelUsed: 'Unknown',
    });
  }
}
