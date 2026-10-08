import {
  apiErrorSchema,
  greetingResponseSchema,
  type Greeting,
  type GreetingQuery,
} from '@repo/contracts';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(
  /\/+$/,
  '',
);

export async function fetchTranscriptionToken(
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/api/v1/transcription/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-Transcription-Client': 'web' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : 'Could not start transcription. Please try again.',
    );
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('token' in body) ||
    typeof body.token !== 'string' ||
    !body.token
  ) {
    throw new Error('The API returned an invalid transcription token.');
  }
  return body.token;
}

export async function fetchGreeting(
  query: GreetingQuery,
  signal?: AbortSignal,
): Promise<Greeting> {
  const params = new URLSearchParams({ name: query.name });
  const response = await fetch(
    `${apiBaseUrl}/api/v1/greeting?${params.toString()}`,
    {
      headers: { Accept: 'application/json' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    },
  );
  const body: unknown = await response.json();

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new Error(
      parsed.success
        ? (parsed.data.error.details?.[0]?.message ?? parsed.data.error.message)
        : `Request failed (${response.status}). Please try again.`,
    );
  }

  const parsed = greetingResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new Error('The API returned an unexpected response.');

  return parsed.data.data;
}
