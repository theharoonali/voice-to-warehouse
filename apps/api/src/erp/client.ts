import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../errors/http-error.js';

// EXP020 exports a purchase order with its positions.
const ORDER_EXPORT_PATH = '/web/services/EXP020';

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

export type ErpOrder = z.infer<typeof erpOrderSchema>;
export type ErpPosition = z.infer<typeof erpPositionSchema>;

let selfSignedAgent: Agent | undefined;

function postJson(url: string, body: unknown, signal: AbortSignal) {
  const credentials = Buffer.from(
    `${env.ERP_USERNAME}:${env.ERP_PASSWORD}`,
  ).toString('base64');
  const init = {
    method: 'POST',
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
  selfSignedAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return undiciFetch(url, { ...init, dispatcher: selfSignedAgent });
}

export function isErpConfigured(): boolean {
  return Boolean(env.ERP_BASE_URL && env.ERP_USERNAME && env.ERP_PASSWORD);
}

export async function fetchErpOrder(
  bestellnummer: number,
  signal?: AbortSignal,
): Promise<ErpOrder> {
  if (!isErpConfigured()) {
    throw new HttpError(
      503,
      'INTERNAL_ERROR',
      'The ERP connection is not configured. Set ERP_BASE_URL, ERP_USERNAME, and ERP_PASSWORD on the API server.',
    );
  }
  const timeout = AbortSignal.timeout(15_000);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let body: unknown;
  try {
    const response = await postJson(
      `${env.ERP_BASE_URL}${ORDER_EXPORT_PATH}`,
      { FIRMA: env.ERP_FIRMA, BESTELLNUMMER: bestellnummer },
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
        `The ERP order export failed with status ${response.status}.`,
      );
    }
    body = await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (abortSignal.aborted) {
      throw new HttpError(
        504,
        'INTERNAL_ERROR',
        'The ERP request timed out or was cancelled. Please try again.',
      );
    }
    // Network errors can include the URL and credentials; do not forward them.
    throw new HttpError(
      502,
      'INTERNAL_ERROR',
      'Could not reach the ERP. Check ERP_BASE_URL and the network connection, then try again.',
    );
  }

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
