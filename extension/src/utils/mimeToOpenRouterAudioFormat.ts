/**
 * Maps MIME (or file extension hints) to OpenRouter `input_audio.format`.
 * @see https://openrouter.ai/docs/guides/overview/multimodal/audio
 */
export function mimeToOpenRouterAudioFormat(mimeType: string): string {
  const m = mimeType.split(';')[0]?.trim().toLowerCase() ?? 'application/octet-stream';

  const map: Record<string, string> = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/webm': 'ogg',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff',
  };

  if (map[m]) return map[m];

  if (m === 'application/ogg') return 'ogg';

  const ext = m.split('/')[1];
  if (ext && ['wav', 'mp3', 'ogg', 'aac', 'flac', 'aiff', 'm4a'].includes(ext)) {
    return ext;
  }

  return 'ogg';
}
