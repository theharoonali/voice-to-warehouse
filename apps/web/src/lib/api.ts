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
