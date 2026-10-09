import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import type { ErpReturn, Wareneingang } from '@repo/contracts';
import { env } from '../config/env.js';
import { HttpError } from '../errors/http-error.js';

// EXP020 exports a purchase order with its positions; IMP015 books a goods
// receipt (the ERP accepts one position per call).
const ORDER_EXPORT_PATH = '/web/services/EXP020';
const RECEIPT_IMPORT_PATH = '/web/services/IMP015';

const erpPositionSchema = z.object({
  Positionnummer: z.number().int(),
  Bestellstatus: z.string().default(''),
  Artikelnummerhersteller: z.coerce.string().default(''),
  Artikelnummer: z.coerce.string(),
  Artikelbezeichnung1: z.string().default(''),
  Artikelbezeichnung2: z.string().default(''),
  Einkaufpreis: z.number(),
  Bestellmenge: z.number().default(0),
  Bereitszugebuchtemenge: z.number().default(0),
});

const erpOrderSchema = z.object({
  Firma: z.coerce.string(),
  Bestellnummer: z.number().int(),
  Bestellstatus: z.string().default(''),
  Lieferantennummer: z.coerce.string().default(''),
  positionen: z.array(erpPositionSchema).default([]),
});

const erpOrderExportSchema = z.object({
  bestellung: z.array(erpOrderSchema),
});

// IMP015 answers HTTP 200 with a list of return codes, e.g. RTC001 (Firma
// missing) or RTC100 (booking not accepted).
const erpReturnListSchema = z.object({
  return: z.array(
    z.object({
      returncode: z.coerce.string(),
      message: z.coerce.string().default(''),
    }),
  ),
});

export type ErpOrder = z.infer<typeof erpOrderSchema>;
export type ErpPosition = z.infer<typeof erpPositionSchema>;

let selfSignedAgent: Agent | undefined;

function sendJson(
  method: 'POST' | 'PUT',
  url: string,
  body: unknown,
  signal: AbortSignal,
) {
  const credentials = Buffer.from(
    `${env.ERP_USERNAME}:${env.ERP_PASSWORD}`,
  ).toString('base64');
  const init = {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  };
  if (!env.ERP_ALLOW_SELF_SIGNED) return globalThis.fetch(url, init);
  // Node's built-in fetch cannot relax TLS per request, so use undici's
  // fetch with an agent that accepts the ERP host's self-signed certificate.
  // pipelining: 0 opens a fresh connection per request; the ERP closes idle
  // connections, and reusing one produced sporadic "could not reach" errors.
  selfSignedAgent ??= new Agent({
    connect: { rejectUnauthorized: false },
    pipelining: 0,
  });
  return undiciFetch(url, { ...init, dispatcher: selfSignedAgent });
}

export function isErpConfigured(): boolean {
  return Boolean(env.ERP_BASE_URL && env.ERP_USERNAME && env.ERP_PASSWORD);
}

// A short description of a network error for the server log. It never
// contains the request headers, so no credentials are written.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String(cause.code)
      : '';
  return [
    `${error.name}: ${error.message}`,
    cause instanceof Error ? `caused by ${cause.message}` : '',
    code ? `(${code})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// The ERP sometimes answers with JSON that has trailing commas, which the
// parser rejects. Repair that before giving up.
function parseErpJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    try {
      return JSON.parse(text.replace(/,\s*([\]}])/g, '$1'));
    } catch {
      console.error(
        `ERP ${what} answered invalid JSON: ${describeError(error)} Body: ${text.slice(0, 300)}`,
      );
      throw new HttpError(
        502,
        'INTERNAL_ERROR',
        `The ERP ${what} answered with invalid JSON.`,
      );
    }
  }
}

async function callErp(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  what: string,
  signal: AbortSignal | undefined,
  // Reads are repeated once after a network error; bookings never are,
  // because a lost answer does not mean the booking did not happen.
  retryOnNetworkError: boolean,
): Promise<unknown> {
  if (!isErpConfigured()) {
    throw new HttpError(
      503,
      'INTERNAL_ERROR',
      'The ERP connection is not configured. Set ERP_BASE_URL, ERP_USERNAME, and ERP_PASSWORD on the API server.',
    );
  }
  const timeout = AbortSignal.timeout(15_000);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const attempts = retryOnNetworkError ? 2 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await sendJson(
        method,
        `${env.ERP_BASE_URL}${path}`,
        body,
        abortSignal,
      );
      if (response.status === 401 || response.status === 403) {
        throw new HttpError(
          502,
          'INTERNAL_ERROR',
          'The ERP rejected the server credentials. Check ERP_USERNAME and ERP_PASSWORD.',
        );
      }
      if (!response.ok) {
        throw new HttpError(
          502,
          'INTERNAL_ERROR',
          `The ERP ${what} failed with status ${response.status}.`,
        );
      }
      return parseErpJson(await response.text(), what);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (abortSignal.aborted) {
        throw new HttpError(
          504,
          'INTERNAL_ERROR',
          'The ERP request timed out or was cancelled. Please try again.',
        );
      }
      console.error(
        `ERP ${method} ${path} (${what}) attempt ${attempt} failed: ${describeError(error)}`,
      );
      if (attempt < attempts) continue;
      // Network errors can include the URL and credentials; do not forward them.
      throw new HttpError(
        502,
        'INTERNAL_ERROR',
        'Could not reach the ERP. Check ERP_BASE_URL and the network connection, then try again.',
      );
    }
  }
}

export async function fetchErpOrder(
  bestellnummer: number,
  signal?: AbortSignal,
): Promise<ErpOrder> {
  const body = await callErp(
    'POST',
    ORDER_EXPORT_PATH,
    { FIRMA: env.ERP_FIRMA, BESTELLNUMMER: bestellnummer },
    'order export',
    signal,
    true,
  );
  const parsed = erpOrderExportSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      502,
      'INTERNAL_ERROR',
      'The ERP returned an order in an unexpected format.',
    );
  }
  const order = parsed.data.bestellung.find(
    (candidate) => candidate.Bestellnummer === bestellnummer,
  );
  if (!order) {
    throw new HttpError(
      404,
      'NOT_FOUND',
      `Order ${bestellnummer} was not found in the ERP for company ${env.ERP_FIRMA}.`,
    );
  }
  return order;
}

// Books one goods receipt and returns the ERP's return codes.
export async function putErpGoodsReceipt(
  bestellung: Wareneingang,
  signal?: AbortSignal,
): Promise<ErpReturn[]> {
  const body = await callErp(
    'PUT',
    RECEIPT_IMPORT_PATH,
    { bestellung },
    'goods receipt import',
    signal,
    false,
  );
  const parsed = erpReturnListSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      502,
      'INTERNAL_ERROR',
      'The ERP answered the booking in an unexpected format.',
    );
  }
  return parsed.data.return;
}
