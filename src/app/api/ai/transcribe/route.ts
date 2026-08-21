import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioData, mimeType = 'audio/webm', config = {} } = body;

    if (!audioData || typeof audioData !== 'string') {
      return NextResponse.json(
        { error: 'Audio data is required as a base64 string.' },
        { status: 400 }
      );
    }

    // Clean base64 string if data URI was passed
    const cleanBase64 = audioData.includes('base64,')
      ? audioData.split('base64,')[1]
      : audioData;

    // 1. Check if Groq Whisper is available (either via config or GROQ_API_KEY)
    const customEndpoint = (config.customEndpoint || '').toLowerCase();
    const customKey = config.customApiKey || config.apiKey;
    const isGroq = customEndpoint.includes('groq.com') || Boolean(process.env.GROQ_API_KEY);
    const groqKey = customEndpoint.includes('groq.com') && customKey ? customKey : process.env.GROQ_API_KEY;

    if (isGroq && groqKey) {
      try {
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
        formData.append('file', blob, `dictation.${ext}`);
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'json');

        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
          },
          body: formData,
        });

        if (groqRes.ok) {
          const data = await groqRes.json();
          if (data.text) {
            return NextResponse.json({ transcript: data.text.trim(), provider: 'groq-whisper' });
          }
        }
      } catch (groqErr) {
        console.warn('Groq whisper transcription failed, falling back to Gemini:', groqErr);
      }
    }

    // 2. Gemini Audio Transcription
    const geminiKey =
      config.geminiApiKey ||
      config.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (!geminiKey) {
      return NextResponse.json(
        { error: 'No API key available for audio transcription. Please configure Gemini or Groq API Key in Settings.' },
        { status: 400 }
      );
    }

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
    return NextResponse.json({ transcript, provider: 'gemini' });
  } catch (error: any) {
    console.error('Audio transcription route error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to transcribe audio dictation.' },
      { status: 500 }
    );
  }
}
