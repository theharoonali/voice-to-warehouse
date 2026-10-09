import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { TestContext } from 'node:test';
import type { GoodsReceiptBooking, Wareneingang } from '@repo/contracts';
import { app } from '../app.js';
import { env } from '../config/env.js';

let server: Server;
let url: string;
const originalFetch = globalThis.fetch;
const originalEnv = { ...env };
const ERP_URL = 'https://erp.test/web/services/EXP020';
const BOOK_URL = 'https://erp.test/web/services/IMP015';

function erpPosition(
  Positionnummer: number,
  Artikelnummer: string,
  Artikelbezeichnung1: string,
  Einkaufpreis: number,
  Bereitszugebuchtemenge = 0,
) {
  return {
    Positionnummer,
    Bestellstatus: 'Offene Position',
    Artikelnummerhersteller: Artikelnummer,
    Artikelbezeichnung1,
    Artikelbezeichnung2: '',
    Einkaufpreis,
    Bestellmenge: 30,
    Bereitszugebuchtemenge,
    Artikelnummer,
  };
}

// The ERP order with the given booked quantities per position.
function erpOrder(booked: Record<number, number> = {}) {
  return {
    bestellung: [
      {
        Firma: '01',
        Bestellnummer: 1712,
        Bestellstatus: 'Offene Bestellung',
        Lieferantennummer: '163001',
        positionen: [
          erpPosition(2, '55204', 'Ibuflam 600mg', 2.34, booked[2] ?? 0),
          erpPosition(
            5,
            '55207',
            'Hauptspeicher Samsung 16GB',
            36,
            booked[5] ?? 0,
          ),
        ],
      },
    ],
  };
}

function bookingFor(
  Positionnummer: number,
  Artikelnummer: string,
  Einkaufpreis: number,
  menge: number,
  charge: string,
  invoice: string,
): Wareneingang {
  return {
    Firma: '01',
    Bestellnummer: 1712,
    Lieferanten_Rechnungsnummer: invoice,
    Lieferanten_Rechnungsdatum: '31.12.2026',
    Wareneingangsdatum: '31.12.2026',
    positionen: [
      {
        Positionnummer,
        Artikelnummer,
        Lagerort: 'M53-01-01-02',
        Einkaufpreis,
        Zubuchmenge: menge,
        VCS: [
          {
            Verfalldatum: '122026',
            Charge: charge,
            Seriennummer: '112233',
            Menge: menge,
          },
        ],
      },
    ],
  };
}

const ibuflam = bookingFor(2, '55204', 2.34, 1, 'AB1234', '0815');
const hauptspeicher = bookingFor(5, '55207', 36, 2, 'HS77', '0816');

type Upstream = (input: string, options?: RequestInit) => Response;

function mockErp(
  context: TestContext,
  {
    order = () => Response.json(erpOrder()),
    book = () => {
      throw new Error('The ERP booking must not be called');
    },
  }: { order?: Upstream; book?: Upstream },
) {
  return context.mock.method(
    globalThis,
    'fetch',
    (input: unknown, options?: RequestInit) => {
      const target = String(input);
      if (target === ERP_URL) return Promise.resolve(order(target, options));
      if (target === BOOK_URL) return Promise.resolve(book(target, options));
      throw new Error(`Unexpected request to ${target}`);
    },
  );
}

function book(bestellungen: unknown) {
  return originalFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bestellungen }),
  });
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}/api/v1/goods-receipt/book`;
});
beforeEach(() => {
  env.ERP_BASE_URL = 'https://erp.test';
  env.ERP_USERNAME = 'erp-user';
  env.ERP_PASSWORD = 'erp-secret';
  env.ERP_FIRMA = '01';
  env.ERP_BESTELLNUMMER = 1712;
  env.ERP_ALLOW_SELF_SIGNED = false;
});
afterEach(() => {
  Object.assign(env, originalEnv);
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

void test('books each receipt with one PUT and verifies the booked quantities', async (context) => {
  let orderReads = 0;
  const puts: {
    method: string | undefined;
    auth: string | null;
    body: unknown;
  }[] = [];
  mockErp(context, {
    order: () => {
      orderReads += 1;
      return Response.json(
        orderReads === 1 ? erpOrder() : erpOrder({ 2: 1, 5: 2 }),
      );
    },
    book: (_target, options) => {
      puts.push({
        method: options?.method,
        auth: new Headers(options?.headers).get('authorization'),
        body: JSON.parse(
          typeof options?.body === 'string' ? options.body : '{}',
        ) as unknown,
      });
      return Response.json({
        return: [
          { returncode: 'RTC000', message: 'Zubuchen Ware wurde übernommen.' },
        ],
      });
    },
  });

  const response = await book([ibuflam, hauptspeicher]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { data } = (await response.json()) as { data: GoodsReceiptBooking };

  assert.equal(orderReads, 2);
  assert.deepEqual(
    puts.map((put) => put.method),
    ['PUT', 'PUT'],
  );
  assert.equal(
    puts[0]?.auth,
    `Basic ${Buffer.from('erp-user:erp-secret').toString('base64')}`,
  );
  // The ERP needs the wrapper and exactly one position per call.
  assert.deepEqual(puts[0]?.body, { bestellung: ibuflam });
  assert.deepEqual(puts[1]?.body, { bestellung: hauptspeicher });

  assert.equal(data.allBooked, true);
  assert.deepEqual(
    data.results.map((entry) => [
      entry.Positionnummer,
      entry.booked,
      entry.bookedBefore,
      entry.bookedAfter,
      entry.Lieferanten_Rechnungsnummer,
    ]),
    [
      [2, true, 0, 1, '0815'],
      [5, true, 0, 2, '0816'],
    ],
  );
  assert.deepEqual(
    data.order.positionen.map((position) => [
      position.Positionnummer,
      position.Bereitszugebuchtemenge,
      position.Restmenge,
    ]),
    [
      [2, 1, 29],
      [5, 2, 28],
    ],
  );
});

void test('reports receipts the ERP rejected and keeps the others booked', async (context) => {
  let orderReads = 0;
  let puts = 0;
  mockErp(context, {
    order: () => {
      orderReads += 1;
      return Response.json(orderReads === 1 ? erpOrder() : erpOrder({ 2: 1 }));
    },
    book: () => {
      puts += 1;
      return Response.json(
        puts === 1
          ? { return: [{ returncode: 'RTC000', message: 'OK' }] }
          : {
              return: [
                {
                  returncode: 'RTC041',
                  message: 'Positionnummer: 5 Menge ist ungültig.',
                },
                {
                  returncode: 'RTC100',
                  message: 'Fehlerhalft: Zubuchen Ware wurde nicht übernommen.',
                },
              ],
            },
      );
    },
  });

  const response = await book([ibuflam, hauptspeicher]);
  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: GoodsReceiptBooking };
  assert.equal(puts, 2);
  assert.equal(data.allBooked, false);
  assert.deepEqual(
    data.results.map((entry) => [entry.Positionnummer, entry.booked]),
    [
      [2, true],
      [5, false],
    ],
  );
  assert.deepEqual(
    data.results[1]?.return.map((entry) => entry.returncode),
    ['RTC041', 'RTC100'],
  );
  assert.match(data.results[1]?.return[0]?.message ?? '', /Menge ist ungültig/);
});

void test('does not mark a receipt as booked when the quantities did not change', async (context) => {
  mockErp(context, {
    book: () =>
      Response.json({ return: [{ returncode: 'RTC000', message: 'OK' }] }),
  });
  const { data } = (await (await book([ibuflam])).json()) as {
    data: GoodsReceiptBooking;
  };
  assert.equal(data.allBooked, false);
  assert.deepEqual(
    data.results.map((entry) => [entry.booked, entry.bookedAfter]),
    [[false, 0]],
  );
});

void test('records failed booking calls per position without leaking credentials', async (context) => {
  // An HTTP error from IMP015 is reported for the position, not as a failure
  // of the whole request, and the order is still read again.
  mockErp(context, {
    book: () => Response.json({ detail: 'secret upstream' }, { status: 500 }),
  });
  const failed = await book([ibuflam]);
  assert.equal(failed.status, 200);
  const text = await failed.text();
  assert.doesNotMatch(text, /secret upstream|erp-secret|erp\.test/);
  const { data } = JSON.parse(text) as { data: GoodsReceiptBooking };
  assert.equal(data.allBooked, false);
  assert.deepEqual(
    data.results[0]?.return.map((entry) => entry.returncode),
    ['API'],
  );
  assert.match(data.results[0]?.return[0]?.message ?? '', /status 500/);

  mockErp(context, {
    book: () => {
      throw new TypeError('fetch failed');
    },
  });
  const dropped = (await (await book([ibuflam])).json()) as {
    data: GoodsReceiptBooking;
  };
  assert.match(
    dropped.data.results[0]?.return[0]?.message ?? '',
    /Could not reach the ERP/,
  );

  mockErp(context, { book: () => Response.json({ unexpected: true }) });
  const odd = (await (await book([ibuflam])).json()) as {
    data: GoodsReceiptBooking;
  };
  assert.match(
    odd.data.results[0]?.return[0]?.message ?? '',
    /unexpected format/,
  );

  env.ERP_PASSWORD = undefined;
  const upstream = mockErp(context, {});
  assert.equal((await book([ibuflam])).status, 503);
  assert.equal(upstream.mock.callCount(), 0);
});

void test('retries an order read once and still detects a booking whose answer was lost', async (context) => {
  let orderReads = 0;
  let puts = 0;
  mockErp(context, {
    order: () => {
      orderReads += 1;
      // The first read fails on the network and is repeated.
      if (orderReads === 1) throw new TypeError('fetch failed');
      return Response.json(orderReads === 2 ? erpOrder() : erpOrder({ 2: 1 }));
    },
    book: () => {
      // The ERP booked the receipt but the answer never arrived.
      puts += 1;
      throw new TypeError('socket hang up');
    },
  });
  const response = await book([ibuflam]);
  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: GoodsReceiptBooking };
  assert.equal(puts, 1);
  assert.equal(orderReads, 3);
  assert.deepEqual(
    data.results.map((entry) => [
      entry.booked,
      entry.bookedBefore,
      entry.bookedAfter,
      entry.return[0]?.returncode,
    ]),
    [[true, 0, 1, 'API']],
  );
  assert.equal(data.allBooked, true);
});

void test('rejects booking bodies for another order or without receipts', async (context) => {
  const upstream = mockErp(context, {});
  for (const body of [
    undefined,
    [],
    [{ ...ibuflam, Bestellnummer: 999 }],
    [{ ...ibuflam, Firma: '02' }],
    [{ ...ibuflam, positionen: [{ Positionnummer: 2 }] }],
  ]) {
    assert.equal((await book(body)).status, 400);
  }
  assert.equal(upstream.mock.callCount(), 0);
});
