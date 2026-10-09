// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { GoodsReceipt, GoodsReceiptOrder } from '@repo/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchGoodsReceipt, fetchGoodsReceiptOrder } from '../lib/api';
import { createRef } from 'react';
import {
  GoodsReceiptCard,
  type GoodsReceiptCardHandle,
} from './GoodsReceiptCard';

vi.mock('../lib/api', () => ({
  fetchGoodsReceipt: vi.fn(),
  fetchGoodsReceiptBooking: vi.fn(),
  fetchGoodsReceiptOrder: vi.fn(),
}));

const order: GoodsReceiptOrder = {
  Firma: '01',
  Bestellnummer: 1712,
  Bestellstatus: 'Offene Bestellung',
  Lieferantennummer: '163001',
  positionen: [
    {
      Positionnummer: 2,
      Artikelnummer: '55204',
      Artikelnummerhersteller: '55204',
      Artikelbezeichnung: 'Ibuflam 600mg',
      Bestellstatus: 'Offene Position',
      Einkaufpreis: 2.34,
      Bestellmenge: 9,
      Bereitszugebuchtemenge: 8,
      Restmenge: 1,
    },
    {
      Positionnummer: 3,
      Artikelnummer: '55205',
      Artikelnummerhersteller: '55205',
      Artikelbezeichnung: 'USB Data Cabel',
      Bestellstatus: 'Offene Position',
      Einkaufpreis: 2.34,
      Bestellmenge: 10,
      Bereitszugebuchtemenge: 10,
      Restmenge: 0,
    },
  ],
};

const complete: GoodsReceipt = {
  complete: true,
  items: [
    {
      spoken: 'pack of Ibuflam 600mg',
      Positionnummer: 2,
      Artikelnummer: '55204',
      Artikelbezeichnung: 'Ibuflam 600mg',
      Zubuchmenge: 1,
      Lagerort: 'M53-01-01-02',
      Charge: 'AB1234',
      Verfalldatum: '122027',
      expiryDefaulted: false,
      missing: [],
    },
  ],
  messages: [],
  bestellungen: [
    {
      Firma: '01',
      Bestellnummer: 1712,
      Lieferanten_Rechnungsnummer: '0815',
      Lieferanten_Rechnungsdatum: '31.12.2026',
      Wareneingangsdatum: '31.12.2026',
      positionen: [
        {
          Positionnummer: 2,
          Artikelnummer: '55204',
          Lagerort: 'M53-01-01-02',
          Einkaufpreis: 2.34,
          Zubuchmenge: 1,
          VCS: [
            {
              Verfalldatum: '122027',
              Charge: 'AB1234',
              Seriennummer: '112233',
              Menge: 1,
            },
          ],
        },
      ],
    },
  ],
};

const incomplete: GoodsReceipt = {
  complete: false,
  items: [
    {
      spoken: 'a pack of Ibuflam 600mg',
      Positionnummer: 2,
      Artikelnummer: '55204',
      Artikelbezeichnung: 'Ibuflam 600mg',
      Zubuchmenge: 1,
      Lagerort: null,
      Charge: null,
      Verfalldatum: '122026',
      expiryDefaulted: true,
      missing: ['Lagerort', 'Charge'],
    },
    {
      spoken: 'a pack of tissues',
      Positionnummer: null,
      Artikelnummer: null,
      Artikelbezeichnung: null,
      Zubuchmenge: 1,
      Lagerort: null,
      Charge: null,
      Verfalldatum: '122026',
      expiryDefaulted: true,
      missing: ['Artikelnummer', 'Lagerort', 'Charge'],
    },
  ],
  messages: [
    'Ibuflam 600mg (position 2): bin (Lagerort) and batch (Charge) not said.',
    '"a pack of tissues" is not part of order 1712. Say the article number or a name from the order.',
  ],
  bestellungen: [],
};

async function renderCard(props: { transcript: string; recording: boolean }) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<GoodsReceiptCard {...props} />);
    await Promise.resolve();
  });
  return utils;
}

// The field starts empty (the transcript is the input), so enter text first.
async function submit(text = 'Ibuflam, bin M53-01-01-02, batch AB1234') {
  fireEvent.change(screen.getByLabelText('What arrived'), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Create goods receipt JSON' }),
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.mocked(fetchGoodsReceiptOrder).mockResolvedValue(order);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows the open order positions with the remaining quantity', async () => {
  await renderCard({ transcript: '', recording: false });
  expect(fetchGoodsReceiptOrder).toHaveBeenCalledWith(expect.any(AbortSignal));
  const positions = within(
    screen.getByRole('table', { name: 'Open order positions' }),
  );
  const row = positions.getByRole('row', { name: /Ibuflam 600mg/ });
  const cells = Array.from(row.querySelectorAll('td')).map(
    (cell) => cell.textContent,
  );
  // Ordered, booked, and the remaining quantity (ordered minus booked).
  expect(cells).toEqual(['2', '55204', 'Ibuflam 600mg', '9', '8', '1']);
  const done = positions.getByRole('row', { name: /USB Data Cabel/ });
  expect(done.textContent).toContain('fully booked');
  expect(screen.getByText(/ERP order 1712/)).toBeTruthy();
});

it('sends the text with the loaded order and shows the JSON when complete', async () => {
  vi.mocked(fetchGoodsReceipt).mockResolvedValue(complete);
  await renderCard({ transcript: '', recording: false });
  expect(screen.getByLabelText<HTMLTextAreaElement>('What arrived').value).toBe(
    '',
  );
  await submit('One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'One pack of Ibuflam, bin M53-01-01-02, batch AB1234',
    order,
    expect.any(AbortSignal),
  );
  const review = within(
    screen.getByRole('table', { name: 'Recognised articles' }),
  ).getByRole('row', { name: /Ibuflam 600mg/ });
  expect(review.textContent).toContain('M53-01-01-02');
  expect(review.textContent).toContain('AB1234');
  expect(screen.queryByLabelText(/^Missing:/)).toBeNull();
  const blocks = screen.getAllByLabelText(/^Generated JSON/);
  expect(blocks).toHaveLength(1);
  const output = blocks[0]?.textContent;
  expect(output).toContain('"Positionnummer": 2');
  expect(output).toContain('"Zubuchmenge": 1');
  expect(output).toContain('"Lieferanten_Rechnungsdatum": "31.12.2026"');
  expect(output).toContain('"bestellung": {');
  expect(output).not.toContain('"complete"');
});

it('marks missing details with crosses and withholds the JSON', async () => {
  vi.mocked(fetchGoodsReceipt).mockResolvedValue(incomplete);
  await renderCard({ transcript: '', recording: false });
  await submit();
  const crosses = screen
    .getAllByLabelText(/^Missing:/)
    .map((node) => node.getAttribute('aria-label'));
  expect(crosses).toEqual([
    'Missing: not said',
    'Missing: not said',
    'Missing: not in the order',
    'Missing: not said',
    'Missing: not said',
  ]);
  const tissues = screen.getByRole('row', { name: /tissues/ });
  expect(tissues.textContent).toContain('not in the order');
  expect(tissues.textContent).toContain('Expiry 122026 (default, not said)');
  expect(screen.queryByLabelText(/^Generated JSON/)).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(
    'not part of order 1712',
  );
  expect(screen.getByRole('status').textContent).toContain('5 details missing');
});

it('fills the text when a recording finishes without submitting it', async () => {
  const { rerender } = await renderCard({
    transcript: 'Drei Kisten',
    recording: true,
  });
  const field = screen.getByLabelText<HTMLTextAreaElement>('What arrived');
  expect(field.value).not.toBe('Drei Kisten');
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Use transcript' })
      .disabled,
  ).toBe(true);
  rerender(<GoodsReceiptCard transcript="Drei Kisten" recording={false} />);
  expect(field.value).toBe('Drei Kisten');
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use transcript' }));
  expect(field.value).toBe('Drei Kisten');
});

it('shows API errors for the order and the receipt', async () => {
  vi.mocked(fetchGoodsReceiptOrder).mockRejectedValue(
    new Error('Set ERP_PASSWORD on the API server.'),
  );
  vi.mocked(fetchGoodsReceipt).mockRejectedValue(
    new Error('Set ANTHROPIC_API_KEY on the API server.'),
  );
  await renderCard({ transcript: '', recording: false });
  expect(screen.getByRole('alert').textContent).toContain('ERP_PASSWORD');
  await submit();
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    expect.any(String),
    null,
    expect.any(AbortSignal),
  );
  const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
  expect(alerts.join(' ')).toContain('ANTHROPIC_API_KEY');
});

it('cancels an in-flight request and re-enables input', async () => {
  vi.mocked(fetchGoodsReceipt).mockImplementation(
    (_text, _order, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Cancelled'))),
      ),
  );
  await renderCard({ transcript: '', recording: false });
  fireEvent.change(screen.getByLabelText('What arrived'), {
    target: { value: 'Ibuflam, bin M53-01-01-02, batch AB1234' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Create goods receipt JSON' }),
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>('What arrived').disabled,
  ).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await Promise.resolve();
  });
  expect(vi.mocked(fetchGoodsReceipt).mock.calls[0]?.[2].aborted).toBe(true);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>('What arrived').disabled,
  ).toBe(false);
  expect(screen.queryByText(/ANTHROPIC|Cancelled/)).toBeNull();
});

it('creates the JSON when the parent asks for it after "Done"', async () => {
  vi.mocked(fetchGoodsReceipt).mockResolvedValue(complete);
  const handle = createRef<GoodsReceiptCardHandle>();
  await act(async () => {
    render(<GoodsReceiptCard ref={handle} transcript="" recording={false} />);
    await Promise.resolve();
  });
  await act(async () => {
    handle.current?.create('Ibuflam, bin M53-01-01-02, batch AB1234');
    await Promise.resolve();
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>('What arrived').value).toBe(
    'Ibuflam, bin M53-01-01-02, batch AB1234',
  );
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'Ibuflam, bin M53-01-01-02, batch AB1234',
    order,
    expect.any(AbortSignal),
  );
  expect(screen.getAllByLabelText(/^Generated JSON/)).toHaveLength(1);
});
