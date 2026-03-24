import { mimeToOpenRouterAudioFormat } from '../utils/mimeToOpenRouterAudioFormat';

const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type TranscribeParams = {
  apiKey: string;
  models: string[];
  arrayBuffer: ArrayBuffer;
  mimeType: string;
  languageHint?: string;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

function buildUserText(languageHint?: string): string {
  const base =
    'Transcribe the speech in this audio accurately. If the language is ambiguous, transcribe in the original spoken language. Return only the transcript text, no preamble.';
  if (languageHint?.trim()) {
    return `${base} Prefer language/locale hint: ${languageHint.trim()}.`;
  }
  return base;
}

type OpenRouterErrorBody = {
  error?: { message?: string; code?: number | string; metadata?: { raw?: unknown } };
  message?: string;
};

function parseErrorMessage(status: number, bodyText: string): string {
  try {
    const j = JSON.parse(bodyText) as OpenRouterErrorBody;
    const primary = j.error?.message ?? j.message ?? `HTTP ${status}`;
    const raw = j.error?.metadata?.raw;
    if (raw != null) {
      const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (rawStr.trim() && !primary.includes(rawStr.slice(0, 80))) {
        return `${primary} — ${rawStr.slice(0, 280)}`;
      }
    }
    return primary;
  } catch {
    return bodyText || `HTTP ${status}`;
  }
}

function extractAssistantText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    choices?: Array<{
      message?: { content?: string | null };
      finish_reason?: string | null;
    }>;
  };
  const content = d.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  return null;
}

async function postTranscription(
  apiKey: string,
  models: string[],
  base64Audio: string,
  format: string,
  userText: string,
): Promise<{ text: string }> {
  const body = {
    models,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: userText },
          {
            type: 'input_audio',
            input_audio: {
              data: base64Audio,
              format,
            },
          },
        ],
      },
    ],
    stream: false,
  };

  const run = async (): Promise<{ text: string }> => {
    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/zaptranscribe',
        'X-OpenRouter-Title': 'ZapTranscribe',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(parseErrorMessage(res.status, text));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error('Invalid JSON from OpenRouter');
    }

    const out = extractAssistantText(parsed);
    if (!out) throw new Error('Empty transcription from model');
    return { text: out };
  };

  try {
    return await run();
  } catch (e) {
    if (e instanceof TypeError) {
      await new Promise((r) => setTimeout(r, 400));
      return run();
    }
    throw e;
  }
}

/** Transcribes audio via OpenRouter chat completions + input_audio; uses `models` for failover. */
export async function transcribeWithOpenRouter(params: TranscribeParams): Promise<string> {
  const { apiKey, models, arrayBuffer, mimeType, languageHint } = params;
  if (!models.length) throw new Error('No models configured');

  const format = mimeToOpenRouterAudioFormat(mimeType);
  const base64Audio = arrayBufferToBase64(arrayBuffer);
  const userText = buildUserText(languageHint);

  const { text } = await postTranscription(apiKey, models, base64Audio, format, userText);
  return text;
}
