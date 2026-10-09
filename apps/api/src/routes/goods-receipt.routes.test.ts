import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { TestContext } from 'node:test';
import type { GoodsReceipt, GoodsReceiptOrder } from '@repo/contracts';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { normaliseExpiry } from '../services/goods-receipt.service.js';

let server: Server;
let url: string;
const originalFetch = globalThis.fetch;
const originalEnv = { ...env };
const ERP_URL = 'https://erp.test/web/services/EXP020';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

function erpPosition(
  Positionnummer: number,
  Artikelnummer: string,
  Artikelbezeichnung1: string,
  Einkaufpreis: number,
  Bestellmenge = 30,
  Bereitszugebuchtemenge = 0,
) {
  return {
    Positionnummer,
    PositionsID: 0,
    Bestellstatus: 'Offene Position',
    Artikelnummerhersteller: Artikelnummer,
    Lieferantennummer: '163001',
    Artikelkennzeichen: 'Standard',
    Artikelbezeichnung1,
    Artikelbezeichnung2: '',
    Lagerfuerbestellung: 'L001',
    Lagerfuerbestandsbuchung: 'L001',
    Einkaufpreis,
    Bestellmenge,
    Bereitszugebuchtemenge,
    Komisionstext: '',
    Interneinfo1: '',
    Interninfo2: '',
    Artikelnummer,
    Änderungzeit: '2026-10-09-00.50.06.428526',
  };
}

const erpOrder = {
  bestellung: [
    {
      Firma: '01',
      Bestellnummer: 1712,
      Bestellstatus: 'Offene Bestellung',
      Bestelldatum: '09.10.2026',
      Lieferantennummer: '163001',
      Standortlager: 'L001',
      positionen: [
        erpPosition(1, '55203', 'Bepanthen Augen- und Nasensalbe', 2.34),
        erpPosition(2, '55204', 'Ibuflam 600mg', 2.34),
        erpPosition(4, '55206', 'Mascot Lazhose', 55),
        erpPosition(5, '55207', 'Hauptspeicher Samsung 16GB', 36),
        erpPosition(6, '55207', 'Hauptspeicher Samsung 16GB', 36),
        erpPosition(7, '55208', 'Bioniq Repair Zahncreme', 2.34, 9, 8),
        erpPosition(8, '55209', 'USB Data Cabel', 2.34, 10, 10),
      ],
    },
  ],
};

type Item = {
  spoken: string;
  positionNumber: number | null;
  quantity: number | null;
  bin: string | null;
  batch: string | null;
  expiry: string | null;
};

function providerResponse(items: Item[]) {
  return Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: env.ANTHROPIC_MODEL,
    content: [
      { type: 'text', text: JSON.stringify({ language: 'de', items }) },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 50 },
  });
}

type Upstream = (input: string, options?: RequestInit) => Response;

function mockUpstreams(
  context: TestContext,
  {
    erp = () => Response.json(erpOrder),
    claude = () => {
      throw new Error('Claude must not be called');
    },
  }: { erp?: Upstream; claude?: Upstream },
) {
  return context.mock.method(
    globalThis,
    'fetch',
    (input: unknown, options?: RequestInit) => {
      const target = String(input);
      if (target === ERP_URL) return Promise.resolve(erp(target, options));
      if (target === CLAUDE_URL)
        return Promise.resolve(claude(target, options));
      throw new Error(`Unexpected request to ${target}`);
    },
  );
}

function request(body: unknown) {
  return originalFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function receipt(response: Response): Promise<GoodsReceipt> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as { success: true; data: GoodsReceipt };
  return body.data;
}

// Serial numbers are random: check their format and key order, compare the rest.
function withoutSerials<
  T extends {
    VCS: {
      Verfalldatum: string;
      Charge: string;
      Seriennummer: string;
      Menge: number;
    }[];
  },
>(positions: (T | undefined)[]) {
  return positions.map((position) => {
    assert.ok(position);
    return {
      ...position,
      VCS: position.VCS.map((entry) => {
        assert.deepEqual(Object.keys(entry), [
          'Verfalldatum',
          'Charge',
          'Seriennummer',
          'Menge',
        ]);
        assert.match(entry.Seriennummer, /^[0-9]{6}$/);
        return {
          Verfalldatum: entry.Verfalldatum,
          Charge: entry.Charge,
          Menge: entry.Menge,
        };
      }),
    };
  });
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}/api/v1/goods-receipt`;
});
beforeEach(() => {
  env.ANTHROPIC_API_KEY = 'test-claude-key';
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

void test('books several articles against the matching ERP positions', async (context) => {
  const text =
    'One pack of Ibuflam 600mg in bin M 53 01 01 02, batch A B 1234, expiry December 2027. Two Samsung RAM modules in bin M53-02-01-01, batch HS77. Please book them in.';
  let erpBody = '';
  let claudeBody = '';
  const upstream = mockUpstreams(context, {
    erp: (_target, options) => {
      assert.equal(options?.method, 'POST');
      const headers = new Headers(options?.headers);
      assert.equal(
        headers.get('authorization'),
        `Basic ${Buffer.from('erp-user:erp-secret').toString('base64')}`,
      );
      assert.ok(typeof options?.body === 'string');
      erpBody = options.body;
      return Response.json(erpOrder);
    },
    claude: (_target, options) => {
      assert.equal(
        new Headers(options?.headers).get('x-api-key'),
        'test-claude-key',
      );
      assert.ok(typeof options?.body === 'string');
      claudeBody = options.body;
      return providerResponse([
        {
          spoken: 'pack of Ibuflam 600mg',
          positionNumber: 2,
          quantity: 1,
          bin: 'm53-01-01-02',
          batch: 'ab 1234',
          expiry: '122027',
        },
        {
          spoken: 'two Samsung RAM modules',
          positionNumber: 5,
          quantity: 2,
          bin: 'M53-02-01-01',
          batch: 'HS77',
          expiry: null,
        },
      ]);
    },
  });

  const response = await request({ text });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await receipt(response);
  assert.equal(upstream.mock.callCount(), 2);
  assert.deepEqual(JSON.parse(erpBody), { FIRMA: '01', BESTELLNUMMER: 1712 });
  assert.match(claudeBody, /Hauptspeicher Samsung 16GB/);
  assert.match(claudeBody, /Please book them in/);
  assert.match(claudeBody, /json_schema/);

  assert.equal(data.complete, true);
  assert.deepEqual(data.messages, []);
  assert.deepEqual(
    data.items.map((item) => [
      item.Positionnummer,
      item.missing,
      item.Verfalldatum,
      item.expiryDefaulted,
    ]),
    [
      [2, [], '122027', false],
      [5, [], '122026', true],
    ],
  );
  // One booking per position, because the ERP accepts a single position per call.
  assert.equal(data.bestellungen.length, 2);
  for (const booking of data.bestellungen) {
    assert.deepEqual(Object.keys(booking), [
      'Firma',
      'Bestellnummer',
      'Lieferanten_Rechnungsnummer',
      'Lieferanten_Rechnungsdatum',
      'Wareneingangsdatum',
      'positionen',
    ]);
    assert.equal(booking.Firma, '01');
    assert.equal(booking.Bestellnummer, 1712);
    assert.match(booking.Lieferanten_Rechnungsnummer, /^[0-9]{4}$/);
    assert.equal(booking.Lieferanten_Rechnungsdatum, '31.12.2026');
    assert.equal(booking.Wareneingangsdatum, '31.12.2026');
    assert.equal(booking.positionen.length, 1);
  }
  assert.deepEqual(
    withoutSerials(data.bestellungen.map((booking) => booking.positionen[0])),
    [
      {
        Positionnummer: 2,
        Artikelnummer: '55204',
        Lagerort: 'M53-01-01-02',
        Einkaufpreis: 2.34,
        Zubuchmenge: 1,
        VCS: [{ Verfalldatum: '122027', Charge: 'AB1234', Menge: 1 }],
      },
      {
        Positionnummer: 5,
        Artikelnummer: '55207',
        Lagerort: 'M53-02-01-01',
        Einkaufpreis: 36,
        Zubuchmenge: 2,
        VCS: [{ Verfalldatum: '122026', Charge: 'HS77', Menge: 2 }],
      },
    ],
  );
});

void test('uses the order supplied by the app without reading the ERP again', async (context) => {
  mockUpstreams(context, {});
  const loaded = await originalFetch(`${url}/order`);
  const { data: order } = (await loaded.json()) as {
    data: GoodsReceiptOrder;
  };

  let claudeBody = '';
  const upstream = mockUpstreams(context, {
    erp: () => {
      throw new Error('The ERP must not be read again');
    },
    claude: (_target, options) => {
      claudeBody = typeof options?.body === 'string' ? options.body : '';
      return providerResponse([
        {
          spoken: 'Mascot Lazhose',
          positionNumber: 4,
          quantity: 3,
          bin: 'M53-01-02-01',
          batch: 'LZ99',
          expiry: null,
        },
      ]);
    },
  });
  const data = await receipt(await request({ text: 'Drei Mascot', order }));
  assert.equal(upstream.mock.callCount(), 1);
  const prompt =
    (JSON.parse(claudeBody) as { system: { text: string }[] }).system[0]
      ?.text ?? '';
  assert.match(prompt, /"Restmenge":1\b/);
  assert.equal(data.complete, true);
  assert.deepEqual(withoutSerials(data.bestellungen[0]?.positionen ?? []), [
    {
      Positionnummer: 4,
      Artikelnummer: '55206',
      Lagerort: 'M53-01-02-01',
      Einkaufpreis: 55,
      Zubuchmenge: 3,
      VCS: [{ Verfalldatum: '122026', Charge: 'LZ99', Menge: 3 }],
    },
  ]);
});

void test('marks missing details per article and withholds the JSON', async (context) => {
  mockUpstreams(context, {
    claude: () =>
      providerResponse([
        {
          spoken: 'a pack of Ibuflam 600mg',
          positionNumber: 2,
          quantity: 1,
          bin: null,
          batch: null,
          expiry: null,
        },
        {
          spoken: 'two Samsung RAM modules',
          positionNumber: 5,
          quantity: 2,
          bin: 'M53-02-01-01',
          batch: 'HS77',
          expiry: null,
        },
        {
          spoken: 'a pack of tissues',
          positionNumber: null,
          quantity: 1,
          bin: null,
          batch: null,
          expiry: null,
        },
        {
          spoken: 'Zahncreme',
          positionNumber: 99,
          quantity: null,
          bin: null,
          batch: null,
          expiry: null,
        },
      ]),
  });
  const data = await receipt(
    await request({
      text: 'I have a pack of Ibuflam 600mg, two Samsung RAM modules, and a pack of tissues. Please book them in.',
    }),
  );
  assert.equal(data.complete, false);
  assert.deepEqual(data.bestellungen, []);
  assert.deepEqual(
    data.items.map((item) => ({
      Positionnummer: item.Positionnummer,
      Artikelbezeichnung: item.Artikelbezeichnung,
      Zubuchmenge: item.Zubuchmenge,
      Lagerort: item.Lagerort,
      Charge: item.Charge,
      missing: item.missing,
    })),
    [
      {
        Positionnummer: 2,
        Artikelbezeichnung: 'Ibuflam 600mg',
        Zubuchmenge: 1,
        Lagerort: null,
        Charge: null,
        missing: ['Lagerort', 'Charge'],
      },
      {
        Positionnummer: 5,
        Artikelbezeichnung: 'Hauptspeicher Samsung 16GB',
        Zubuchmenge: 2,
        Lagerort: 'M53-02-01-01',
        Charge: 'HS77',
        missing: [],
      },
      {
        Positionnummer: null,
        Artikelbezeichnung: null,
        Zubuchmenge: 1,
        Lagerort: null,
        Charge: null,
        missing: ['Artikelnummer', 'Lagerort', 'Charge'],
      },
      {
        Positionnummer: null,
        Artikelbezeichnung: null,
        Zubuchmenge: null,
        Lagerort: null,
        Charge: null,
        missing: ['Artikelnummer', 'Zubuchmenge', 'Lagerort', 'Charge'],
      },
    ],
  );
  assert.deepEqual(data.messages, [
    'Ibuflam 600mg (position 2): bin (Lagerort) and batch (Charge) not said.',
    '"a pack of tissues" is not part of order 1712. Say the article number or a name from the order.',
    '"Zahncreme" is not part of order 1712. Say the article number or a name from the order.',
  ]);
});

void test('merges two batches of one article into a single position', async (context) => {
  mockUpstreams(context, {
    claude: () =>
      providerResponse([
        {
          spoken: 'Hauptspeicher',
          positionNumber: 5,
          quantity: 4,
          bin: 'M53-02-01-01',
          batch: 'A1',
          expiry: '01.2028',
        },
        {
          spoken: 'Hauptspeicher',
          positionNumber: 5,
          quantity: 6,
          bin: 'M53-02-01-01',
          batch: 'B2',
          expiry: null,
        },
      ]),
  });
  const data = await receipt(
    await request({ text: 'Zehn Hauptspeicher, zwei Chargen' }),
  );
  assert.equal(data.complete, true);
  assert.equal(data.items.length, 2);
  assert.deepEqual(withoutSerials(data.bestellungen[0]?.positionen ?? []), [
    {
      Positionnummer: 5,
      Artikelnummer: '55207',
      Lagerort: 'M53-02-01-01',
      Einkaufpreis: 36,
      Zubuchmenge: 10,
      VCS: [
        { Verfalldatum: '012028', Charge: 'A1', Menge: 4 },
        { Verfalldatum: '122026', Charge: 'B2', Menge: 6 },
      ],
    },
  ]);
});

void test('filters the order positions by Artikelnummerhersteller', async (context) => {
  let claudeBody = '';
  const upstream = mockUpstreams(context, {
    claude: (_target, options) => {
      claudeBody = typeof options?.body === 'string' ? options.body : '';
      return providerResponse([]);
    },
  });
  const data = await receipt(
    await request({
      text: 'Nichts erkannt',
      artikelnummerhersteller: [55206, '55207'],
    }),
  );
  // Only the filtered positions may appear in the order list given to Claude.
  const system =
    (JSON.parse(claudeBody) as { system: { text: string }[] }).system[0]
      ?.text ?? '';
  const catalogue = system.slice(system.indexOf('Order positions:'));
  assert.match(catalogue, /Mascot Lazhose/);
  assert.match(catalogue, /Hauptspeicher Samsung 16GB/);
  assert.doesNotMatch(catalogue, /Ibuflam|Bepanthen/);
  assert.equal(data.complete, false);
  assert.deepEqual(data.bestellungen, []);
  assert.deepEqual(data.items, []);
  assert.match(data.messages[0] ?? '', /^No article from order 1712/);

  const none = await request({ text: 'x', artikelnummerhersteller: ['1'] });
  assert.equal(none.status, 404);
  assert.equal(upstream.mock.callCount(), 3);
});

void test('returns the configured order for the app', async (context) => {
  mockUpstreams(context, {});
  const response = await originalFetch(`${url}/order`);
  assert.equal(response.status, 200);
  const { data } = (await response.json()) as { data: GoodsReceiptOrder };
  assert.equal(data.Bestellnummer, 1712);
  assert.equal(data.positionen.length, 7);
  assert.deepEqual(data.positionen[1], {
    Positionnummer: 2,
    Artikelnummer: '55204',
    Artikelnummerhersteller: '55204',
    Artikelbezeichnung: 'Ibuflam 600mg',
    Bestellstatus: 'Offene Position',
    Einkaufpreis: 2.34,
    Bestellmenge: 30,
    Bereitszugebuchtemenge: 0,
    Restmenge: 30,
  });
  // Remaining quantity is ordered minus already booked, never negative.
  assert.deepEqual(
    data.positionen.slice(-2).map((position) => ({
      Positionnummer: position.Positionnummer,
      Bestellmenge: position.Bestellmenge,
      Bereitszugebuchtemenge: position.Bereitszugebuchtemenge,
      Restmenge: position.Restmenge,
    })),
    [
      {
        Positionnummer: 7,
        Bestellmenge: 9,
        Bereitszugebuchtemenge: 8,
        Restmenge: 1,
      },
      {
        Positionnummer: 8,
        Bestellmenge: 10,
        Bereitszugebuchtemenge: 10,
        Restmenge: 0,
      },
    ],
  );
});

void test('handles ERP failures without leaking credentials', async (context) => {
  mockUpstreams(context, { erp: () => Response.json({ bestellung: [] }) });
  const notFound = await request({ text: 'Ibuflam' });
  assert.equal(notFound.status, 404);
  assert.match(await notFound.text(), /Order 1712 was not found/);

  mockUpstreams(context, {
    erp: () => Response.json({ detail: 'secret upstream' }, { status: 401 }),
  });
  const rejected = await request({ text: 'Ibuflam' });
  assert.equal(rejected.status, 502);
  const rejectedText = await rejected.text();
  assert.doesNotMatch(rejectedText, /secret upstream|erp-secret|erp\.test/);
  assert.match(rejectedText, /ERP_PASSWORD/);

  mockUpstreams(context, { erp: () => Response.json({ nope: true }) });
  assert.equal((await request({ text: 'Ibuflam' })).status, 502);

  env.ERP_PASSWORD = undefined;
  const upstream = mockUpstreams(context, {});
  const unconfigured = await request({ text: 'Ibuflam' });
  assert.equal(unconfigured.status, 503);
  assert.match(await unconfigured.text(), /ERP_PASSWORD/);
  assert.equal(upstream.mock.callCount(), 0);
});

void test('rejects invalid input before contacting the ERP or Claude', async (context) => {
  const upstream = mockUpstreams(context, {});
  for (const body of [
    {},
    { text: '   ' },
    { text: 'x'.repeat(8_001) },
    { text: 'Ibuflam', artikelnummerhersteller: '55203' },
    { text: 'Ibuflam', artikelnummerhersteller: [''] },
    { text: 'Ibuflam', order: { Bestellnummer: 'nope' } },
  ]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal(upstream.mock.callCount(), 0);
  env.ANTHROPIC_API_KEY = undefined;
  assert.equal((await request({ text: 'Ibuflam' })).status, 503);
});

void test('normalises expiry dates to MMYYYY', () => {
  assert.equal(normaliseExpiry('122027'), '122027');
  assert.equal(normaliseExpiry('12.2027'), '122027');
  assert.equal(normaliseExpiry('31.12.2027'), '122027');
  assert.equal(normaliseExpiry('01/28'), '012028');
  assert.equal(normaliseExpiry('132027'), '');
  assert.equal(normaliseExpiry('Dezember'), '');
  assert.equal(normaliseExpiry(null), '');
});
