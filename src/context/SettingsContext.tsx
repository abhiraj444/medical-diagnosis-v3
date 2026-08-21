'use client';

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import type { AiProvider, AiConfig, SttProvider, SttConfig } from '@/types';

export type TargetLanguage = 'english' | 'hinglish';
export type AudienceMode = 'doctor' | 'simplified';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash';
export const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';

interface SettingsContextType {
    // AI Provider Configuration
    aiProvider: AiProvider;
    setAiProvider: (provider: AiProvider) => void;
    
    // Gemini Settings
    apiKey: string; // alias for geminiApiKey for backwards compatibility
    setApiKey: (key: string) => void;
    geminiApiKey: string;
    setGeminiApiKey: (key: string) => void;
    geminiModel: string;
    setGeminiModel: (model: string) => void;
    
    // Custom LLM / Endpoint Settings
    customEndpoint: string;
    setCustomEndpoint: (endpoint: string) => void;
    customApiKey: string;
    setCustomApiKey: (key: string) => void;
    customModel: string;
    setCustomModel: (model: string) => void;

    // Speech-to-Text (STT) Settings
    sttProvider: SttProvider;
    setSttProvider: (provider: SttProvider) => void;
    sttApiKey: string;
    setSttApiKey: (key: string) => void;
    sttEndpoint: string;
    setSttEndpoint: (endpoint: string) => void;
    sttModel: string;
    setSttModel: (model: string) => void;
    sttConfig: SttConfig;

    // Derived AI state
    activeModel: string;
    aiConfig: AiConfig;
    isConfigured: boolean;
    hasServerKey: boolean;

    // Language & Audience Preferences
    language: TargetLanguage;
    setLanguage: (lang: TargetLanguage) => void;
    audienceMode: AudienceMode;
    setAudienceMode: (mode: AudienceMode) => void;
    compressImagesForAi: boolean;
    setCompressImagesForAi: (enabled: boolean) => void;
    targetImageKb: number;
    setTargetImageKb: (kb: number) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [aiProvider, setAiProviderInternal] = useState<AiProvider>('gemini');
    const [geminiApiKey, setGeminiApiKeyInternal] = useState<string>('');
    const [geminiModel, setGeminiModelInternal] = useState<string>(DEFAULT_GEMINI_MODEL);
    const [hasServerKey, setHasServerKey] = useState<boolean>(false);

    const [customEndpoint, setCustomEndpointInternal] = useState<string>('');
    const [customApiKey, setCustomApiKeyInternal] = useState<string>('');
    const [customModel, setCustomModelInternal] = useState<string>('gpt-4o');

    // STT State
    const [sttProvider, setSttProviderInternal] = useState<SttProvider>('groq');
    const [sttApiKey, setSttApiKeyInternal] = useState<string>('');
    const [sttEndpoint, setSttEndpointInternal] = useState<string>('https://api.groq.com/openai/v1');
    const [sttModel, setSttModelInternal] = useState<string>(DEFAULT_STT_MODEL);

    const [language, setLanguageInternal] = useState<TargetLanguage>('english');
    const [audienceMode, setAudienceModeInternal] = useState<AudienceMode>('doctor');
    const [compressImagesForAi, setCompressImagesForAiInternal] = useState<boolean>(true);
    const [targetImageKb, setTargetImageKbInternal] = useState<number>(50);

    useEffect(() => {
        // Check if server-side environment variable is configured
        fetch('/api/ai/status')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data?.hasServerKey) {
                    setHasServerKey(true);
                }
            })
            .catch(() => {
                // Ignore background fetch failure
            });

        // Load Provider
        const savedProvider = localStorage.getItem('app_ai_provider') as AiProvider | null;
        if (savedProvider === 'gemini' || savedProvider === 'custom') {
            setAiProviderInternal(savedProvider);
        }

        // Load Gemini Config
        const savedGeminiKey = localStorage.getItem('gemini_api_key');
        if (savedGeminiKey) {
            setGeminiApiKeyInternal(savedGeminiKey);
        } else if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
            setGeminiApiKeyInternal(process.env.NEXT_PUBLIC_GEMINI_API_KEY);
        }

        const savedGeminiModel = localStorage.getItem('app_gemini_model');
        if (savedGeminiModel) {
            setGeminiModelInternal(savedGeminiModel);
        } else {
            setGeminiModelInternal(DEFAULT_GEMINI_MODEL);
        }

        // Load Custom LLM Endpoint Config
        const savedEndpoint = localStorage.getItem('app_custom_endpoint');
        if (savedEndpoint) {
            setCustomEndpointInternal(savedEndpoint);
        }
        const savedCustomKey = localStorage.getItem('app_custom_api_key');
        if (savedCustomKey) {
            setCustomApiKeyInternal(savedCustomKey);
        }
        const savedCustomModel = localStorage.getItem('app_custom_model');
        if (savedCustomModel) {
            setCustomModelInternal(savedCustomModel);
        }

        // Load STT Config
        const savedSttProvider = localStorage.getItem('app_stt_provider') as SttProvider | null;
        if (savedSttProvider && ['groq', 'openai', 'gemini', 'custom'].includes(savedSttProvider)) {
            setSttProviderInternal(savedSttProvider);
        }
        const savedSttKey = localStorage.getItem('app_stt_api_key');
        if (savedSttKey) {
            setSttApiKeyInternal(savedSttKey);
        }
        const savedSttEndpoint = localStorage.getItem('app_stt_endpoint');
        if (savedSttEndpoint) {
            setSttEndpointInternal(savedSttEndpoint);
        }
        const savedSttModel = localStorage.getItem('app_stt_model');
        if (savedSttModel) {
            setSttModelInternal(savedSttModel);
        }

        // Load Language & Audience
        const savedLang = localStorage.getItem('app_target_language') as TargetLanguage | null;
        if (savedLang === 'english' || savedLang === 'hinglish') {
            setLanguageInternal(savedLang);
        }

        const savedMode = localStorage.getItem('app_audience_mode') as AudienceMode | null;
        if (savedMode === 'doctor' || savedMode === 'simplified') {
            setAudienceModeInternal(savedMode);
        }

        const savedCompress = localStorage.getItem('app_compress_images_for_ai');
        if (savedCompress !== null) {
            setCompressImagesForAiInternal(savedCompress === 'true');
        }

        const savedTargetKb = localStorage.getItem('app_target_image_kb');
        if (savedTargetKb) {
            const parsed = parseInt(savedTargetKb, 10);
            if (!isNaN(parsed) && parsed >= 20 && parsed <= 300) {
                setTargetImageKbInternal(parsed);
            }
        }
    }, []);

    const setAiProvider = (provider: AiProvider) => {
        localStorage.setItem('app_ai_provider', provider);
        setAiProviderInternal(provider);
    };

    const setGeminiApiKey = (key: string) => {
        localStorage.setItem('gemini_api_key', key);
        setGeminiApiKeyInternal(key);
    };

    // Alias for backwards compatibility
    const setApiKey = (key: string) => {
        setGeminiApiKey(key);
    };

    const setGeminiModel = (model: string) => {
        const sanitized = model.trim() || DEFAULT_GEMINI_MODEL;
        localStorage.setItem('app_gemini_model', sanitized);
        setGeminiModelInternal(sanitized);
    };

    const setCustomEndpoint = (endpoint: string) => {
        localStorage.setItem('app_custom_endpoint', endpoint);
        setCustomEndpointInternal(endpoint);
    };

    const setCustomApiKey = (key: string) => {
        localStorage.setItem('app_custom_api_key', key);
        setCustomApiKeyInternal(key);
    };

    const setCustomModel = (model: string) => {
        localStorage.setItem('app_custom_model', model);
        setCustomModelInternal(model);
    };

    const setSttProvider = (provider: SttProvider) => {
        localStorage.setItem('app_stt_provider', provider);
        setSttProviderInternal(provider);
    };

    const setSttApiKey = (key: string) => {
        localStorage.setItem('app_stt_api_key', key);
        setSttApiKeyInternal(key);
    };

    const setSttEndpoint = (endpoint: string) => {
        localStorage.setItem('app_stt_endpoint', endpoint);
        setSttEndpointInternal(endpoint);
    };

    const setSttModel = (model: string) => {
        const sanitized = model.trim() || DEFAULT_STT_MODEL;
        localStorage.setItem('app_stt_model', sanitized);
        setSttModelInternal(sanitized);
    };

    const setLanguage = (lang: TargetLanguage) => {
        localStorage.setItem('app_target_language', lang);
        setLanguageInternal(lang);
    };

    const setAudienceMode = (mode: AudienceMode) => {
        localStorage.setItem('app_audience_mode', mode);
        setAudienceModeInternal(mode);
    };

    const setCompressImagesForAi = (enabled: boolean) => {
        localStorage.setItem('app_compress_images_for_ai', String(enabled));
        setCompressImagesForAiInternal(enabled);
    };

    const setTargetImageKb = (kb: number) => {
        const sanitized = Math.max(20, Math.min(300, kb));
        localStorage.setItem('app_target_image_kb', String(sanitized));
        setTargetImageKbInternal(sanitized);
    };

    // Derived values
    const isConfigured =
        aiProvider === 'gemini'
            ? (!!geminiApiKey || hasServerKey)
            : !!customEndpoint.trim() && !!customModel.trim();

    const activeModel =
        aiProvider === 'gemini'
            ? geminiModel || DEFAULT_GEMINI_MODEL
            : customModel || 'Custom Model';

    const sttConfig: SttConfig = useMemo(() => ({
        provider: sttProvider,
        apiKey: sttApiKey,
        endpoint: sttEndpoint,
        model: sttModel || DEFAULT_STT_MODEL,
    }), [sttProvider, sttApiKey, sttEndpoint, sttModel]);

    const aiConfig: AiConfig = useMemo(() => ({
        provider: aiProvider,
        apiKey: geminiApiKey,
        geminiApiKey,
        geminiModel: geminiModel || DEFAULT_GEMINI_MODEL,
        customEndpoint,
        customApiKey,
        customModel,
        sttConfig,
    }), [aiProvider, geminiApiKey, geminiModel, customEndpoint, customApiKey, customModel, sttConfig]);

    return (
        <SettingsContext.Provider
            value={{
                aiProvider,
                setAiProvider,
                apiKey: geminiApiKey,
                setApiKey,
                geminiApiKey,
                setGeminiApiKey,
                geminiModel,
                setGeminiModel,
                customEndpoint,
                setCustomEndpoint,
                customApiKey,
                setCustomApiKey,
                customModel,
                setCustomModel,
                sttProvider,
                setSttProvider,
                sttApiKey,
                setSttApiKey,
                sttEndpoint,
                setSttEndpoint,
                sttModel,
                setSttModel,
                sttConfig,
                activeModel,
                aiConfig,
                isConfigured,
                hasServerKey,
                language,
                setLanguage,
                audienceMode,
                setAudienceMode,
                compressImagesForAi,
                setCompressImagesForAi,
                targetImageKb,
                setTargetImageKb,
            }}
        >
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}

