import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioData, mimeType = 'audio/webm', sttConfig, config = {} } = body;

    if (!audioData || typeof audioData !== 'string') {
      return NextResponse.json(
        { error: 'Audio data is required as a base64 string or data URI.' },
        { status: 400 }
      );
    }

    // Clean base64 string if data URI was passed
    const cleanBase64 = audioData.includes('base64,')
      ? audioData.split('base64,')[1]
      : audioData;

    // Resolve active STT configuration
    const activeSttConfig = sttConfig || config.sttConfig || {};
    const provider = activeSttConfig.provider || (process.env.GROQ_API_KEY ? 'groq' : 'gemini');
    const sttKey = activeSttConfig.apiKey || process.env.GROQ_API_KEY || (provider === 'gemini' ? (config.geminiApiKey || process.env.GEMINI_API_KEY) : '');
    const customEndpoint = (activeSttConfig.endpoint || '').trim();
    const sttModel = activeSttConfig.model || (provider === 'openai' ? 'whisper-1' : 'whisper-large-v3-turbo');

    // Helper: Convert base64 to Blob & FormData for Whisper endpoints
    const createWhisperFormData = (modelName: string) => {
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

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
      const ext = extMap[mimeType] || 'webm';

      const formData = new FormData();
      const blob = new Blob([bytes], { type: mimeType });
      formData.append('file', blob, `speech_recording.${ext}`);
      formData.append('model', modelName);
      formData.append('response_format', 'json');
      return formData;
    };

    // 1. Groq Cloud Whisper STT
    if (provider === 'groq' && sttKey) {
      try {
        const formData = createWhisperFormData(sttModel || 'whisper-large-v3-turbo');
        const groqUrl = customEndpoint
          ? (customEndpoint.endsWith('/audio/transcriptions') ? customEndpoint : `${customEndpoint.replace(/\/+$/, '')}/audio/transcriptions`)
          : 'https://api.groq.com/openai/v1/audio/transcriptions';

        const groqRes = await fetch(groqUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sttKey}`,
          },
          body: formData,
        });

        if (groqRes.ok) {
          const data = await groqRes.json();
          if (data.text) {
            return NextResponse.json({
              transcript: data.text.trim(),
              provider: 'groq-whisper',
              model: sttModel || 'whisper-large-v3-turbo',
            });
          }
        } else {
          console.warn('Groq STT returned non-200:', groqRes.status, await groqRes.text());
        }
      } catch (groqErr) {
        console.warn('Groq whisper transcription error, testing fallback:', groqErr);
      }
    }

    // 2. OpenAI Whisper STT
    if (provider === 'openai' && sttKey) {
      try {
        const formData = createWhisperFormData(sttModel || 'whisper-1');
        const openaiUrl = customEndpoint
          ? (customEndpoint.endsWith('/audio/transcriptions') ? customEndpoint : `${customEndpoint.replace(/\/+$/, '')}/audio/transcriptions`)
          : 'https://api.openai.com/v1/audio/transcriptions';

        const openaiRes = await fetch(openaiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sttKey}`,
          },
          body: formData,
        });

        if (openaiRes.ok) {
          const data = await openaiRes.json();
          if (data.text) {
            return NextResponse.json({
              transcript: data.text.trim(),
              provider: 'openai-whisper',
              model: sttModel || 'whisper-1',
            });
          }
        } else {
          console.warn('OpenAI STT returned non-200:', openaiRes.status, await openaiRes.text());
        }
      } catch (openaiErr) {
        console.warn('OpenAI Whisper transcription error, testing fallback:', openaiErr);
      }
    }

    // 3. Custom OpenAI-compatible Whisper STT Endpoint
    if (provider === 'custom' && customEndpoint) {
      try {
        const formData = createWhisperFormData(sttModel || 'whisper-large-v3-turbo');
        let endpointUrl = customEndpoint.trim();
        if (endpointUrl.endsWith('/chat/completions')) {
          endpointUrl = endpointUrl.replace(/\/chat\/completions$/, '');
        }
        if (!endpointUrl.endsWith('/audio/transcriptions')) {
          endpointUrl = `${endpointUrl.replace(/\/+$/, '')}/audio/transcriptions`;
        }

        const headers: Record<string, string> = {};
        if (sttKey) {
          headers['Authorization'] = `Bearer ${sttKey}`;
        }

        const customRes = await fetch(endpointUrl, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (customRes.ok) {
          const data = await customRes.json();
          if (data.text) {
            return NextResponse.json({
              transcript: data.text.trim(),
              provider: 'custom-whisper',
              model: sttModel || 'whisper-large-v3-turbo',
            });
          }
        } else {
          console.warn('Custom STT endpoint returned non-200:', customRes.status, await customRes.text());
        }
      } catch (customErr) {
        console.warn('Custom STT transcription error, testing fallback:', customErr);
      }
    }

    // 4. Server GROQ_API_KEY fallback if user didn't provide custom STT key but server has one
    if (process.env.GROQ_API_KEY && (!sttKey || provider !== 'groq')) {
      try {
        const formData = createWhisperFormData('whisper-large-v3-turbo');
        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: formData,
        });

        if (groqRes.ok) {
          const data = await groqRes.json();
          if (data.text) {
            return NextResponse.json({
              transcript: data.text.trim(),
              provider: 'groq-whisper (server fallback)',
              model: 'whisper-large-v3-turbo',
            });
          }
        }
      } catch (serverGroqErr) {
        console.warn('Server Groq fallback error:', serverGroqErr);
      }
    }

    // 5. Gemini Audio Transcription Fallback
    const geminiKey =
      config.geminiApiKey ||
      config.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (geminiKey) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent([
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType || 'audio/webm',
            },
          },
          'Transcribe this clinical audio recording/voice memo verbatim into clear text. Capture all medical terms, medication names, dosages, and patient symptoms accurately with proper clinical capitalization and punctuation. Output ONLY the raw transcribed text with no conversational preamble or commentary.',
        ]);

        const transcript = result.response.text().trim();
        return NextResponse.json({
          transcript,
          provider: 'gemini-audio (fallback)',
          model: 'gemini-2.5-flash',
        });
      } catch (geminiErr: any) {
        console.error('Gemini audio transcription fallback failed:', geminiErr);
      }
    }

    return NextResponse.json(
      {
        error:
          'Speech-to-text transcription could not be completed. Please configure a Groq, OpenAI, Custom STT, or Gemini API key in Settings.',
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Audio transcription route error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to transcribe audio dictation.' },
      { status: 500 }
    );
  }
}
