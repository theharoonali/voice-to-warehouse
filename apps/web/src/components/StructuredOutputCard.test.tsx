// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchStructuredOutput } from '../lib/api';
import { StructuredOutputCard } from './StructuredOutputCard';

vi.mock('../lib/api', () => ({ fetchStructuredOutput: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('sends edited text and displays the returned object', async () => {
  vi.mocked(fetchStructuredOutput).mockResolvedValue({
    summary: 'Move boxes',
    language: 'en',
    itemCount: 1,
    isUrgent: false,
    tags: ['move'],
    items: [{ name: 'boxes', quantity: 3 }],
    location: { source: null, destination: 'A' },
    notes: null,
  });
  render(<StructuredOutputCard transcript="" recording={false} />);
  fireEvent.change(screen.getByLabelText('Text to convert'), {
    target: { value: 'Move three boxes' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Generate JSON' }));
    await Promise.resolve();
  });
  expect(fetchStructuredOutput).toHaveBeenCalledWith(
    'Move three boxes',
    expect.any(AbortSignal),
  );
  const output = screen.getByLabelText('Generated JSON').textContent;
  expect(output).toContain('"quantity": 3');
  expect(output).toContain('"isUrgent": false');
  expect(output).toContain('"source": null');
});

it('uses a completed transcript without automatically submitting it', () => {
  const { rerender } = render(
    <StructuredOutputCard transcript="Drei Kisten" recording />,
  );
  expect(
    screen.getByRole<HTMLButtonElement>('button', {
      name: 'Use transcript',
    }).disabled,
  ).toBe(true);
  rerender(<StructuredOutputCard transcript="Drei Kisten" recording={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use transcript' }));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>('Text to convert').value,
  ).toBe('Drei Kisten');
  expect(fetchStructuredOutput).not.toHaveBeenCalled();
});

it('shows API configuration errors', async () => {
  vi.mocked(fetchStructuredOutput).mockRejectedValue(
    new Error('Set ANTHROPIC_API_KEY on the API server.'),
  );
  render(<StructuredOutputCard transcript="" recording={false} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Generate JSON' }));
    await Promise.resolve();
  });
  expect(screen.getByRole('alert').textContent).toContain('ANTHROPIC_API_KEY');
});

it('cancels an in-flight request and re-enables input', async () => {
  vi.mocked(fetchStructuredOutput).mockImplementation(
    (_text, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Cancelled'))),
      ),
  );
  render(<StructuredOutputCard transcript="" recording={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate JSON' }));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>('Text to convert').disabled,
  ).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await Promise.resolve();
  });
  expect(vi.mocked(fetchStructuredOutput).mock.calls[0]?.[1].aborted).toBe(
    true,
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>('Text to convert').disabled,
  ).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});
