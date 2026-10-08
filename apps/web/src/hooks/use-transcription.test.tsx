// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- Scribe.connect is replaced with a standalone Vitest mock. */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scribe } from '@elevenlabs/client';
import { fetchTranscriptionToken } from '../lib/api';
import { useTranscription } from './use-transcription';

vi.mock('../lib/api', () => ({ fetchTranscriptionToken: vi.fn() }));
vi.mock('@elevenlabs/client', () => ({
  Scribe: { connect: vi.fn() },
  CommitStrategy: { VAD: 'vad' },
  RealtimeEvents: {
    SESSION_STARTED: 'session_started',
    PARTIAL_TRANSCRIPT: 'partial_transcript',
    COMMITTED_TRANSCRIPT: 'committed_transcript',
    ERROR: 'error',
    CLOSE: 'close',
  },
}));

function mockConnection() {
  const listeners = new Map<string, (value: unknown) => void>();
  return {
    on: vi.fn((event: string, listener: (value: unknown) => void) =>
      listeners.set(event, listener),
    ),
    close: vi.fn(),
    mute: vi.fn(),
    emit: (event: string, value: unknown = {}) =>
      act(() => listeners.get(event)?.(value)),
  };
}

let connection: ReturnType<typeof mockConnection>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  connection = mockConnection();
  vi.mocked(Scribe.connect).mockReturnValue(
    connection as unknown as ReturnType<typeof Scribe.connect>,
  );
  vi.mocked(fetchTranscriptionToken).mockResolvedValue('temporary-token');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('live transcription lifecycle', () => {
  it('uses the selected language and replaces interim text with committed words', async () => {
    const { result } = renderHook(() => useTranscription('de'));
    await act(() => result.current.start());
    expect(Scribe.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCode: 'de',
        token: 'temporary-token',
        commitStrategy: 'vad',
      }),
    );
    connection.emit('session_started');
    connection.emit('partial_transcript', { text: 'Guten' });
    connection.emit('partial_transcript', { text: 'Guten Morgen' });
    expect(result.current.partial).toBe('Guten Morgen');
    connection.emit('committed_transcript', { text: 'Guten Morgen.' });
    connection.emit('committed_transcript', { text: 'Drei Paletten.' });
    expect(result.current.segments).toEqual([
      'Guten Morgen.',
      'Drei Paletten.',
    ]);
    expect(result.current.partial).toBe('');
    expect(result.current.status).toBe('listening');
  });

  it('mutes on stop, accepts the final words, then closes the connection', async () => {
    const { result } = renderHook(() => useTranscription('en'));
    await act(() => result.current.start());
    connection.emit('session_started');
    connection.emit('partial_transcript', { text: 'Three boxes' });
    act(() => result.current.stop());
    expect(connection.mute).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('stopping');
    connection.emit('committed_transcript', { text: 'Three boxes.' });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(connection.close).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('idle');
    expect(result.current.segments).toEqual(['Three boxes.']);
    connection.emit('close');
    expect(result.current.error).toBe('');
  });

  it('cancels a pending token request and ignores its late response', async () => {
    let resolveToken: (token: string) => void = () => {};
    vi.mocked(fetchTranscriptionToken).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const { result } = renderHook(() => useTranscription('en'));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.start();
    });
    act(() => result.current.stop());
    expect(vi.mocked(fetchTranscriptionToken).mock.calls[0]?.[0].aborted).toBe(
      true,
    );
    await act(async () => {
      resolveToken('late-token');
      await pending;
    });
    expect(Scribe.connect).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('releases resources on error and keeps received words', async () => {
    const { result } = renderHook(() => useTranscription('en'));
    await act(() => result.current.start());
    connection.emit('partial_transcript', { text: 'Keep these words' });
    connection.emit('error', {
      message_type: 'error',
      error: 'Permission denied',
    });
    expect(result.current.error).toContain('Microphone access was denied');
    expect(result.current.partial).toBe('Keep these words');
    expect(connection.close).toHaveBeenCalledOnce();
    connection.emit('partial_transcript', { text: 'stale result' });
    expect(result.current.partial).toBe('Keep these words');
  });

  it('times out a stuck connection and releases resources on unmount', async () => {
    const { result, unmount } = renderHook(() => useTranscription('en'));
    await act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.error).toContain('timed out');
    expect(connection.close).toHaveBeenCalledOnce();
    await act(() => result.current.start());
    unmount();
    expect(connection.close).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate starts and reports token errors', async () => {
    const { result } = renderHook(() => useTranscription('en'));
    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });
    expect(fetchTranscriptionToken).toHaveBeenCalledOnce();
    act(() => result.current.stop());
    vi.mocked(fetchTranscriptionToken).mockRejectedValue(
      new Error('Service unavailable'),
    );
    await act(() => result.current.start());
    expect(result.current.error).toBe('Service unavailable');
    expect(result.current.status).toBe('idle');
  });
});
