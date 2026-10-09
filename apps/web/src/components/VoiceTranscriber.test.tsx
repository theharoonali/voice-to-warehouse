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
import { VoiceTranscriber } from './VoiceTranscriber';

const hook = vi.hoisted(() => ({
  status: 'idle',
  error: '',
  segments: [] as string[],
  partial: '',
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
}));
const useTranscriptionMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/use-transcription', () => ({
  useTranscription: useTranscriptionMock,
}));
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
      Verfalldatum: '122026',
      expiryDefaulted: true,
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
              Verfalldatum: '122026',
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
    positionen: order.positionen.map((position) =>
      position.Positionnummer === 2
        ? { ...position, Bereitszugebuchtemenge: 9, Restmenge: 0 }
        : position,
    ),
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

type Rerender = (ui: React.ReactNode) => void;

async function renderApp() {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<VoiceTranscriber />);
    await Promise.resolve();
  });
  return utils;
}

async function rerenderApp(rerender: Rerender) {
  await act(async () => {
    rerender(<VoiceTranscriber />);
    await Promise.resolve();
  });
}

// Ends the current recording the way the hook does: status idle plus the
// onEnd callback with the recorded words.
async function stopRecording(rerender: Rerender) {
  hook.status = 'idle';
  const options = useTranscriptionMock.mock.calls.at(-1)?.[1] as
    | { onEnd?: (words: { segments: string[]; partial: string }) => void }
    | undefined;
  await act(async () => {
    options?.onEnd?.({ segments: hook.segments, partial: hook.partial });
    rerender(<VoiceTranscriber />);
    await Promise.resolve();
  });
}

// Simulates a recording of the given sentences that the worker stops by hand.
async function record(rerender: Rerender, ...segments: string[]) {
  hook.status = 'listening';
  hook.segments = segments;
  await rerenderApp(rerender);
  await stopRecording(rerender);
}

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  hook.status = 'idle';
  hook.error = '';
  hook.segments = [];
  hook.partial = '';
  useTranscriptionMock.mockImplementation(() => hook);
  vi.mocked(fetchGoodsReceiptOrder).mockResolvedValue(order);
  vi.mocked(fetchGoodsReceipt).mockResolvedValue(complete);
  vi.mocked(fetchGoodsReceiptBooking).mockResolvedValue(booked);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('shows the open order positions with ordered, booked and remaining', async () => {
  await renderApp();
  expect(fetchGoodsReceiptOrder).toHaveBeenCalledWith(expect.any(AbortSignal));
  const positions = within(
    screen.getByRole('table', { name: 'Open Positions' }),
  );
  const row = positions.getByRole('row', { name: /Ibuflam 600mg/ });
  expect(
    Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent),
  ).toEqual(['2', '55204', 'Ibuflam 600mg', '9', '8', '1']);
  expect(
    positions.getByRole('row', { name: /USB Data Cabel/ }).textContent,
  ).toContain('fully booked');
  expect(screen.getByText('AI-powered goods receipt')).toBeTruthy();
  expect(screen.queryByText(/1712/)).toBeNull();
});

it('switches the speaking language from the header', async () => {
  await renderApp();
  expect(useTranscriptionMock.mock.calls.at(-1)?.[0]).toBe('en');
  await click('DE');
  expect(useTranscriptionMock.mock.calls.at(-1)?.[0]).toBe('de');
  expect(
    screen
      .getByRole<HTMLButtonElement>('button', { name: 'DE' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
});

it('starts and stops a recording with the space bar', async () => {
  const { rerender } = await renderApp();
  fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
  expect(hook.start).toHaveBeenCalledTimes(1);

  hook.status = 'listening';
  await rerenderApp(rerender);
  fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
  expect(hook.stop).toHaveBeenCalledTimes(1);
});

it('stops when the worker says done and creates the receipt without the word', async () => {
  const { rerender } = await renderApp();
  hook.status = 'listening';
  hook.segments = ['Five Ibuflam in bin M53-01-01-02, batch AB1234.'];
  await rerenderApp(rerender);
  expect(hook.stop).not.toHaveBeenCalled();

  hook.segments = [...hook.segments, 'Done.'];
  await rerenderApp(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(1);
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();

  await stopRecording(rerender);
  expect(fetchGoodsReceipt).toHaveBeenCalledTimes(1);
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'Five Ibuflam in bin M53-01-01-02, batch AB1234',
    order,
    expect.any(AbortSignal),
  );
  expect(
    screen.getByRole('table', { name: 'Goods receipt to book' }),
  ).toBeTruthy();

  // Nothing else happens until the next recording.
  await rerenderApp(rerender);
  expect(fetchGoodsReceipt).toHaveBeenCalledTimes(1);
});

it('creates the receipt when a recording is stopped by hand', async () => {
  const { rerender } = await renderApp();
  await record(rerender, 'Drei Kisten.');
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'Drei Kisten.',
    order,
    expect.any(AbortSignal),
  );
});

it('shows the receipt as tables with the JSON per booking and lets the worker add an expiry date', async () => {
  const { rerender } = await renderApp();
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  const review = within(
    screen.getByRole('table', { name: 'Recognised articles' }),
  );
  expect(
    review.getByRole('row', { name: /Ibuflam 600mg/ }).textContent,
  ).toContain('AB1234');
  expect(screen.queryByLabelText(/^Missing:/)).toBeNull();

  const booking = within(
    screen.getByRole('table', { name: 'Goods receipt to book' }),
  );
  const row = booking.getByRole('row', { name: /Ibuflam 600mg/ });
  expect(
    Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent),
  ).toEqual([
    '1',
    '2',
    'Ibuflam 600mg55204',
    'M53-01-01-02',
    '1',
    'AB1234',
    '122026',
    '112233',
    '2.34',
    '0815',
  ]);

  // The expiry was not said: the worker adds it, and the booking JSON follows.
  await click('Add expiry date');
  fireEvent.change(screen.getByLabelText('Expiry date (MMYYYY)'), {
    target: { value: '13/2027' },
  });
  await click('Save');
  expect(screen.getByRole('alert').textContent).toContain('MMYYYY');
  fireEvent.change(screen.getByLabelText('Expiry date (MMYYYY)'), {
    target: { value: '032028' },
  });
  await click('Save');
  expect(screen.queryByRole('button', { name: 'Add expiry date' })).toBeNull();
  expect(
    within(
      screen.getByRole('table', { name: 'Goods receipt to book' }),
    ).getByRole('row', { name: /Ibuflam 600mg/ }).textContent,
  ).toContain('032028');
  expect(fetchGoodsReceiptBooking).not.toHaveBeenCalled();
});

it('marks missing details with crosses and withholds the booking', async () => {
  vi.mocked(fetchGoodsReceipt).mockResolvedValue(incomplete);
  const { rerender } = await renderApp();
  await record(
    rerender,
    'I have a pack of Ibuflam 600mg and a pack of tissues',
  );
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
  expect(screen.getByText('5 missing')).toBeTruthy();
  expect(
    screen.queryByRole('table', { name: 'Goods receipt to book' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Confirm and book in ERP' }),
  ).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(
    'not part of order 1712',
  );
});

it('books the receipt in the ERP on confirm and updates the open positions', async () => {
  const { rerender } = await renderApp();
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  await click('Confirm and book in ERP');
  expect(fetchGoodsReceiptBooking).toHaveBeenCalledWith(
    complete.bestellungen,
    expect.any(AbortSignal),
  );
  const results = screen.getByRole('list', { name: 'Booking results' });
  expect(results.textContent).toContain('Booked');
  expect(results.textContent).toContain('booked 8 → 9');
  expect(results.textContent).toContain('Zubuchen Ware wurde übernommen.');
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Booked in ERP' })
      .disabled,
  ).toBe(true);
  const positions = within(
    screen.getByRole('table', { name: 'Open Positions' }),
  );
  expect(
    positions.getByRole('row', { name: /Ibuflam 600mg/ }).textContent,
  ).toContain('fully booked');
});

it('offers a retry for positions the ERP rejected', async () => {
  vi.mocked(fetchGoodsReceiptBooking).mockResolvedValue(rejected);
  const { rerender } = await renderApp();
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  await click('Confirm and book in ERP');
  const results = screen.getByRole('list', { name: 'Booking results' });
  expect(results.textContent).toContain('Not booked');
  expect(results.textContent).toContain('Menge ist ungültig');
  await click('Retry rejected bookings');
  expect(fetchGoodsReceiptBooking).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetchGoodsReceiptBooking).mock.calls[1]?.[0]).toEqual(
    complete.bestellungen,
  );
});

it('shows API errors for the order, the receipt and the booking', async () => {
  vi.mocked(fetchGoodsReceiptOrder).mockRejectedValue(
    new Error('Set ERP_PASSWORD on the API server.'),
  );
  vi.mocked(fetchGoodsReceipt).mockRejectedValue(
    new Error('Set ANTHROPIC_API_KEY on the API server.'),
  );
  const { rerender } = await renderApp();
  expect(screen.getByRole('alert').textContent).toContain('ERP_PASSWORD');
  await record(rerender, 'Ibuflam');
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'Ibuflam',
    null,
    expect.any(AbortSignal),
  );
  const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
  expect(alerts.join(' ')).toContain('ANTHROPIC_API_KEY');

  vi.mocked(fetchGoodsReceipt).mockResolvedValue(complete);
  vi.mocked(fetchGoodsReceiptBooking).mockRejectedValue(
    new Error('The ERP rejected the server credentials.'),
  );
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  await click('Confirm and book in ERP');
  expect(
    screen
      .getAllByRole('alert')
      .map((node) => node.textContent)
      .join(' '),
  ).toContain('rejected the server credentials');
});

it('cancels a receipt that is still being created', async () => {
  vi.mocked(fetchGoodsReceipt).mockImplementation(
    (_text, _order, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Cancelled'))),
      ),
  );
  const { rerender } = await renderApp();
  await record(rerender, 'Ibuflam, bin, batch');
  expect(screen.getByText('Agent is working…')).toBeTruthy();
  await click('Cancel');
  expect(vi.mocked(fetchGoodsReceipt).mock.calls[0]?.[2].aborted).toBe(true);
  expect(screen.queryByText('Agent is working…')).toBeNull();
  expect(
    screen.getByText('Say what arrived and finish with “Done”.'),
  ).toBeTruthy();
});

it('opens the confirmation as a sheet on small screens', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const { rerender } = await renderApp();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Confirmation' })).toBeNull();

  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  const sheet = within(screen.getByRole('dialog'));
  expect(
    sheet.getByRole('table', { name: 'Goods receipt to book' }),
  ).toBeTruthy();
  expect(
    sheet.getByRole('button', { name: 'Confirm and book in ERP' }),
  ).toBeTruthy();

  await click('Close');
  expect(screen.queryByRole('dialog')).toBeNull();
  await click('Show confirmation');
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('table', { name: 'Open Positions' })).toBeTruthy();
});

it('discards the recording when the worker says cancel, in English or German', async () => {
  const { rerender } = await renderApp();
  hook.status = 'listening';
  hook.segments = ['Five Ibuflam in bin M53-01-01-02.', 'Cancel.'];
  await rerenderApp(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(1);
  await stopRecording(rerender);
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();
  expect(screen.getAllByRole('status')[0]?.textContent).toContain('Cancelled');
  expect(
    screen.getByText('Say what arrived and finish with “Done”.'),
  ).toBeTruthy();

  hook.status = 'listening';
  hook.segments = ['Drei Kisten.', 'Abbrechen.'];
  await rerenderApp(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(2);
  await stopRecording(rerender);
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();

  // The next recording works as usual.
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  expect(fetchGoodsReceipt).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('status')[0]?.textContent).toContain('Ready');
});

it('listens for the confirmation after a receipt and books it when the worker says done', async () => {
  const { rerender } = await renderApp();
  expect(hook.start).not.toHaveBeenCalled();
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  // The receipt is shown: the app starts listening for "Done".
  expect(hook.start).toHaveBeenCalledTimes(1);
  expect(fetchGoodsReceiptBooking).not.toHaveBeenCalled();

  hook.status = 'listening';
  hook.segments = [];
  await rerenderApp(rerender);
  expect(screen.getByText('Say “Done” to book')).toBeTruthy();
  expect(screen.getAllByRole('status')[0]?.textContent).toContain(
    'Listening for “Done”',
  );

  hook.segments = ['Done.'];
  await rerenderApp(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(1);
  await stopRecording(rerender);
  expect(fetchGoodsReceiptBooking).toHaveBeenCalledWith(
    complete.bestellungen,
    expect.any(AbortSignal),
  );
  expect(fetchGoodsReceipt).toHaveBeenCalledTimes(1);
  // Once booked, the app does not ask again.
  await rerenderApp(rerender);
  expect(hook.start).toHaveBeenCalledTimes(1);
  expect(
    within(screen.getByRole('table', { name: 'Open Positions' })).getByRole(
      'row',
      { name: /Ibuflam 600mg/ },
    ).textContent,
  ).toContain('fully booked');
});

it('replaces the receipt when the worker says new words instead of confirming', async () => {
  const { rerender } = await renderApp();
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  expect(hook.start).toHaveBeenCalledTimes(1);

  hook.status = 'listening';
  hook.segments = [
    'Two packs of Ibuflam, bin M53-01-01-02, batch AB1234',
    'Done.',
  ];
  await rerenderApp(rerender);
  await stopRecording(rerender);
  expect(fetchGoodsReceiptBooking).not.toHaveBeenCalled();
  expect(fetchGoodsReceipt).toHaveBeenLastCalledWith(
    'Two packs of Ibuflam, bin M53-01-01-02, batch AB1234',
    order,
    expect.any(AbortSignal),
  );
  // A new receipt asks for its own confirmation.
  expect(hook.start).toHaveBeenCalledTimes(2);
});

it('discards the shown receipt when the worker says cancel while confirming', async () => {
  const { rerender } = await renderApp();
  await record(rerender, 'One pack of Ibuflam, bin M53-01-01-02, batch AB1234');
  hook.status = 'listening';
  hook.segments = ['Cancel.'];
  await rerenderApp(rerender);
  await stopRecording(rerender);
  expect(fetchGoodsReceiptBooking).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('table', { name: 'Goods receipt to book' }),
  ).toBeNull();
  expect(
    screen.getByText('Say what arrived and finish with “Done”.'),
  ).toBeTruthy();
  // The whole state starts over, including a fresh read of the open positions.
  expect(fetchGoodsReceiptOrder).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole('status')[0]?.textContent).toContain('Cancelled');
});

it('acts on done and cancel as soon as they appear in the live words', async () => {
  const { rerender } = await renderApp();
  hook.status = 'listening';
  hook.segments = ['Five Ibuflam in bin M53-01-01-02, batch AB1234.'];
  hook.partial = 'done';
  await rerenderApp(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(1);
  expect(hook.stop).toHaveBeenLastCalledWith(true);
  await stopRecording(rerender);
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'Five Ibuflam in bin M53-01-01-02, batch AB1234',
    order,
    expect.any(AbortSignal),
  );

  hook.status = 'listening';
  hook.segments = [];
  hook.partial = 'cancel';
  await rerenderApp(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(2);
  expect(hook.stop).toHaveBeenLastCalledWith(true);
  await stopRecording(rerender);
  expect(screen.getAllByRole('status')[0]?.textContent).toContain('Cancelled');
  expect(
    screen.queryByRole('table', { name: 'Goods receipt to book' }),
  ).toBeNull();
});
