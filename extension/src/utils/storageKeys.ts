export const STORAGE_API_KEY = 'zap_openrouter_api_key';
export const STORAGE_MODELS = 'zap_transcription_models';
export const STORAGE_LANGUAGE = 'zap_transcription_language';
export const STORAGE_CACHE_TTL_MS = 'zap_cache_ttl_ms';

export const CACHE_KEY_PREFIX = 'zap_cache_v1:';

/** Defaults: verify at https://openrouter.ai/models?input_modalities=audio */
export const DEFAULT_MODEL_LINES = [
  'openai/gpt-4o-audio-preview',
  'openai/gpt-audio-mini',
  'google/gemini-2.0-flash-001',
];

export const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
