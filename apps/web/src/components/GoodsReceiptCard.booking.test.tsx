// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type {
  GoodsReceipt,
  GoodsReceiptBooking,
  GoodsReceiptOrder,
} from '@repo/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  fetchGoodsReceipt,
  fetchGoodsReceiptBooking,
  fetchGoodsReceiptOrder,
} from '../lib/api';
import { GoodsReceiptCard } from './GoodsReceiptCard';

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

const booked: GoodsReceiptBooking = {
  allBooked: true,
  results: [
    {
      Positionnummer: 2,
      Artikelnummer: '55204',
      Zubuchmenge: 1,
      Lieferanten_Rechnungsnummer: '0815',
      booked: true,
      bookedBefore: 8,
      bookedAfter: 9,
      return: [
        { returncode: 'RTC000', message: 'Zubuchen Ware wurde übernommen.' },
      ],
    },
  ],
  order: {
    ...order,
    positionen: order.positionen.map((position) => ({
      ...position,
      Bereitszugebuchtemenge: 9,
      Restmenge: 0,
    })),
  },
};

const rejected: GoodsReceiptBooking = {
  allBooked: false,
  results: [
    {
      Positionnummer: 2,
      Artikelnummer: '55204',
      Zubuchmenge: 1,
      Lieferanten_Rechnungsnummer: '0815',
      booked: false,
      bookedBefore: 8,
      bookedAfter: 8,
      return: [
        {
          returncode: 'RTC041',
          message: 'Positionnummer: 2 Menge ist ungültig.',
        },
        {
          returncode: 'RTC100',
          message: 'Fehlerhalft: Zubuchen Ware wurde nicht übernommen.',
        },
      ],
    },
  ],
  order,
};

async function renderWithReceipt() {
  await act(async () => {
    render(<GoodsReceiptCard transcript="" recording={false} />);
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('What arrived'), {
    target: { value: 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234' },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Create goods receipt JSON' }),
    );
    await Promise.resolve();
  });
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.mocked(fetchGoodsReceiptOrder).mockResolvedValue(order);
  vi.mocked(fetchGoodsReceipt).mockResolvedValue(complete);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows the receipt as a table with the JSON available per booking', async () => {
  await renderWithReceipt();
  const table = within(
    screen.getByRole('table', { name: 'Goods receipt to book' }),
  );
  const row = table.getByRole('row', { name: /Ibuflam 600mg/ });
  expect(
    Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent),
  ).toEqual([
    '1',
    '2',
    'Ibuflam 600mg55204',
    'M53-01-01-02',
    '1',
    'AB1234',
    '122027',
    '112233',
    '2.34',
    '0815',
  ]);
  expect(screen.getByText(/JSON for booking 1 \(position 2\)/)).toBeTruthy();
  const json = screen.getByLabelText('Generated JSON 1').textContent;
  expect(json).toContain('"bestellung": {');
  expect(json).toContain('"Seriennummer": "112233"');
  expect(fetchGoodsReceiptBooking).not.toHaveBeenCalled();
});

it('books the receipt in the ERP on confirm and shows the new quantities', async () => {
  vi.mocked(fetchGoodsReceiptBooking).mockResolvedValue(booked);
  await renderWithReceipt();
  await click('Confirm and book in ERP');
  expect(fetchGoodsReceiptBooking).toHaveBeenCalledWith(
    complete.bestellungen,
    expect.any(AbortSignal),
  );
  const results = screen.getByRole('list', { name: 'Booking results' });
  expect(results.textContent).toContain('✓ Booked');
  expect(results.textContent).toContain('Position 2 · Ibuflam 600mg · 1 units');
  expect(results.textContent).toContain('booked 8 → 9');
  expect(results.textContent).toContain(
    'RTC000: Zubuchen Ware wurde übernommen.',
  );
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Booked in ERP' })
      .disabled,
  ).toBe(true);
  const positions = within(
    screen.getByRole('table', { name: 'Open order positions' }),
  );
  const row = positions.getByRole('row', { name: /Ibuflam 600mg/ });
  expect(row.textContent).toContain('fully booked');
});

it('offers a retry for positions the ERP rejected and shows its messages', async () => {
  vi.mocked(fetchGoodsReceiptBooking).mockResolvedValue(rejected);
  await renderWithReceipt();
  await click('Confirm and book in ERP');
  const results = screen.getByRole('list', { name: 'Booking results' });
  expect(results.textContent).toContain('✗ Not booked');
  expect(results.textContent).toContain(
    'RTC041: Positionnummer: 2 Menge ist ungültig.',
  );
  expect(results.textContent).toContain('booked 8 → 8');
  await click('Retry rejected bookings');
  expect(fetchGoodsReceiptBooking).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetchGoodsReceiptBooking).mock.calls[1]?.[0]).toEqual(
    complete.bestellungen,
  );
});

it('shows booking errors from the API', async () => {
  vi.mocked(fetchGoodsReceiptBooking).mockRejectedValue(
    new Error('The ERP rejected the server credentials.'),
  );
  await renderWithReceipt();
  await click('Confirm and book in ERP');
  const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
  expect(alerts.join(' ')).toContain('rejected the server credentials');
  expect(
    screen.getByRole<HTMLButtonElement>('button', {
      name: 'Confirm and book in ERP',
    }).disabled,
  ).toBe(false);
});
