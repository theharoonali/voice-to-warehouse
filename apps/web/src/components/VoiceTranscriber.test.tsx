// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchGoodsReceipt, fetchGoodsReceiptOrder } from '../lib/api';
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

vi.mock('../hooks/use-transcription', () => ({
  useTranscription: () => hook,
}));
vi.mock('../lib/api', () => ({
  fetchGoodsReceipt: vi.fn(),
  fetchGoodsReceiptBooking: vi.fn(),
  fetchGoodsReceiptOrder: vi.fn(),
}));

const order = {
  Firma: '01',
  Bestellnummer: 1712,
  Bestellstatus: 'Offene Bestellung',
  Lieferantennummer: '163001',
  positionen: [],
};

async function renderTranscriber() {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<VoiceTranscriber />);
    await Promise.resolve();
  });
  return utils;
}

async function rerenderTranscriber(rerender: (ui: React.ReactNode) => void) {
  await act(async () => {
    rerender(<VoiceTranscriber />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  hook.status = 'idle';
  hook.error = '';
  hook.segments = [];
  hook.partial = '';
  vi.mocked(fetchGoodsReceiptOrder).mockResolvedValue(order);
  vi.mocked(fetchGoodsReceipt).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('starts and stops a recording with the space bar unless the user is typing', async () => {
  const { rerender } = await renderTranscriber();
  fireEvent.keyDown(screen.getByLabelText('What arrived'), {
    code: 'Space',
    key: ' ',
  });
  expect(hook.start).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
  expect(hook.start).toHaveBeenCalledTimes(1);

  hook.status = 'listening';
  await rerenderTranscriber(rerender);
  fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
  expect(hook.stop).toHaveBeenCalledTimes(1);
  expect(hook.start).toHaveBeenCalledTimes(1);
});

it('stops when the worker says done and creates the JSON from the transcript', async () => {
  const { rerender } = await renderTranscriber();
  hook.status = 'listening';
  hook.segments = ['Five Ibuflam in bin M53-01-01-02, batch AB1234.'];
  await rerenderTranscriber(rerender);
  expect(hook.stop).not.toHaveBeenCalled();

  hook.segments = [...hook.segments, 'Done.'];
  await rerenderTranscriber(rerender);
  expect(hook.stop).toHaveBeenCalledTimes(1);
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();

  hook.status = 'stopping';
  await rerenderTranscriber(rerender);
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();

  hook.status = 'idle';
  await rerenderTranscriber(rerender);
  expect(fetchGoodsReceipt).toHaveBeenCalledWith(
    'Five Ibuflam in bin M53-01-01-02, batch AB1234',
    order,
    expect.any(AbortSignal),
  );
  expect(screen.getByLabelText<HTMLTextAreaElement>('What arrived').value).toBe(
    'Five Ibuflam in bin M53-01-01-02, batch AB1234',
  );
  expect(screen.getByLabelText('Transcript').textContent).toContain('Done.');
});

it('only fills the text field when a recording is stopped by hand', async () => {
  const { rerender } = await renderTranscriber();
  hook.status = 'listening';
  hook.segments = ['Drei Kisten.'];
  await rerenderTranscriber(rerender);
  hook.status = 'idle';
  await rerenderTranscriber(rerender);
  expect(fetchGoodsReceipt).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLTextAreaElement>('What arrived').value).toBe(
    'Drei Kisten.',
  );
});
