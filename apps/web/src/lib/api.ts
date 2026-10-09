import {
  apiErrorSchema,
  goodsReceiptBookResponseSchema,
  goodsReceiptOrderResponseSchema,
  goodsReceiptResponseSchema,
  greetingResponseSchema,
  structuredOutputResponseSchema,
  type GoodsReceipt,
  type GoodsReceiptBooking,
  type GoodsReceiptOrder,
  type Wareneingang,
  type StructuredOutput,
  type Greeting,
  type GreetingQuery,
} from '@repo/contracts';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(
  /\/+$/,
  '',
);

function errorMessage(body: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success
    ? (parsed.data.error.details?.[0]?.message ?? parsed.data.error.message)
    : fallback;
}

// Sends the text with the order the app already loaded, so the API does not
// have to read the ERP again. Without an order the API loads it itself.
export async function fetchGoodsReceipt(
  text: string,
  order: GoodsReceiptOrder | null,
  signal: AbortSignal,
): Promise<GoodsReceipt> {
  const response = await fetch(`${apiBaseUrl}/api/v1/goods-receipt`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(order ? { text, order } : { text }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(70_000)]),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      errorMessage(
        body,
        'Could not create the goods receipt. Please try again.',
      ),
    );
  }
  const parsed = goodsReceiptResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      'The API returned a goods receipt with an unexpected format.',
    );
  return parsed.data.data;
}

export async function fetchGoodsReceiptOrder(
  signal: AbortSignal,
): Promise<GoodsReceiptOrder> {
  const response = await fetch(`${apiBaseUrl}/api/v1/goods-receipt/order`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      errorMessage(body, 'Could not load the purchase order from the ERP.'),
    );
  }
  const parsed = goodsReceiptOrderResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new Error('The API returned an order with an unexpected format.');
  return parsed.data.data;
}

export async function fetchStructuredOutput(
  text: string,
  signal: AbortSignal,
): Promise<StructuredOutput> {
  const response = await fetch(`${apiBaseUrl}/api/v1/structured-output`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      errorMessage(body, 'Could not generate JSON. Please try again.'),
    );
  }
  const parsed = structuredOutputResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new Error('The API returned an object with an unexpected format.');
  return parsed.data.data;
}

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
    throw new Error(
      errorMessage(
        body,
        `Request failed (${response.status}). Please try again.`,
      ),
    );
  }

  const parsed = greetingResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new Error('The API returned an unexpected response.');

  return parsed.data.data;
}

// Books the receipts through the API, which holds the ERP credentials and
// accepts its self-signed certificate. The ERP does not allow browser calls.
export async function fetchGoodsReceiptBooking(
  bestellungen: Wareneingang[],
  signal: AbortSignal,
): Promise<GoodsReceiptBooking> {
  const response = await fetch(`${apiBaseUrl}/api/v1/goods-receipt/book`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ bestellungen }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      errorMessage(body, 'Could not book the goods receipt. Please try again.'),
    );
  }
  const parsed = goodsReceiptBookResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      'The API returned a booking result with an unexpected format.',
    );
  return parsed.data.data;
}
