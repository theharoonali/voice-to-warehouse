import { useEffect, useRef, useState } from 'react';
import type { RealtimeConnection } from '@elevenlabs/client';
import { fetchTranscriptionToken } from '../lib/api';

const RELOAD_FLAG = 'elevenlabs-client-reloaded';

// The ElevenLabs client is loaded on first use. When the dev server has
// re-bundled its dependencies since this page was opened, the page still holds
// the old module URL and the import fails with "Failed to fetch dynamically
// imported module". Reloading once fetches the current bundle; a second
// failure is reported instead of looping.
async function loadElevenLabs() {
  try {
    const client = await import('@elevenlabs/client');
    sessionStorage.removeItem(RELOAD_FLAG);
    return client;
  } catch (error) {
    const stale =
      error instanceof TypeError &&
      /dynamically imported module|Importing a module script failed/i.test(
        error.message,
      );
    if (stale && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
      // Keep the caller waiting while the page reloads.
      await new Promise<never>(() => {});
    }
    throw new Error(
      stale
        ? 'The app was updated. Reload the page, then start the recording again.'
        : 'Could not load the transcription client. Reload the page and try again.',
      { cause: error },
    );
  }
}

export type Language = 'en' | 'de';
type Status = 'idle' | 'connecting' | 'listening' | 'stopping';
type Session = {
  controller: AbortController;
  connection?: RealtimeConnection;
  timer?: ReturnType<typeof setTimeout>;
  stopping: boolean;
};

export type RecordedWords = { segments: string[]; partial: string };

export function useTranscription(
  language: Language,
  options: {
    // Called when a recording ends normally, with the words it produced.
    onEnd?: (words: RecordedWords) => void;
  } = {},
) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [segments, setSegments] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const session = useRef<Session | null>(null);
  // The latest words and callback, read when a recording ends.
  const latest = useRef({ segments, partial, onEnd: options.onEnd });
  useEffect(() => {
    latest.current = { segments, partial, onEnd: options.onEnd };
  });

  useEffect(() => {
    function release() {
      const current = session.current;
      session.current = null;
      current?.controller.abort();
      clearTimeout(current?.timer);
      current?.connection?.close();
    }
    function handlePageHide() {
      release();
      setStatus('idle');
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      release();
    };
  }, []);

  async function start() {
    if (session.current) return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Microphone access requires HTTPS or localhost and a supported browser.',
      );
      return;
    }
    const current: Session = {
      controller: new AbortController(),
      stopping: false,
    };
    session.current = current;
    setStatus('connecting');

    function fail(message: string) {
      if (session.current !== current) return;
      session.current = null;
      clearTimeout(current.timer);
      current.controller.abort();
      current.connection?.close();
      setError(message);
      setStatus('idle');
    }

    try {
      const [{ Scribe, RealtimeEvents, CommitStrategy }, token] =
        await Promise.all([
          loadElevenLabs(),
          fetchTranscriptionToken(current.controller.signal),
        ]);
      if (session.current !== current) return;
      setSegments([]);
      setPartial('');
      const connection = Scribe.connect({
        token,
        modelId: 'scribe_v2_realtime',
        languageCode: language,
        commitStrategy: CommitStrategy.VAD,
        vadSilenceThresholdSecs: 0.7,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      current.connection = connection;
      current.timer = setTimeout(
        () =>
          fail(
            'The connection timed out. Check microphone permissions and try again.',
          ),
        30_000,
      );
      connection.on(RealtimeEvents.SESSION_STARTED, () => {
        if (session.current !== current || current.stopping) return;
        clearTimeout(current.timer);
        setStatus('listening');
      });
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, ({ text }) => {
        if (session.current === current) setPartial(text);
      });
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, ({ text }) => {
        if (session.current !== current) return;
        if (text.trim()) setSegments((previous) => [...previous, text.trim()]);
        setPartial('');
      });
      connection.on(RealtimeEvents.ERROR, ({ message_type, error: detail }) => {
        if (message_type === 'commit_throttled') return;
        const message = /permission|denied|notallowed/i.test(detail)
          ? 'Microphone access was denied. Allow microphone access in your browser, then try again.'
          : /notfound|device not found|requested device/i.test(detail)
            ? 'No microphone was found. Connect a microphone and try again.'
            : message_type === 'quota_exceeded' ||
                message_type === 'rate_limited'
              ? 'ElevenLabs usage limit reached. Check your account or try again later.'
              : 'Transcription was interrupted. Check your microphone, connection, and ElevenLabs account, then try again.';
        fail(message);
      });
      connection.on(RealtimeEvents.CLOSE, () => {
        if (session.current !== current) return;
        fail(
          'The transcription connection closed. Your transcript is still here; start again to record a new one.',
        );
      });
    } catch (cause) {
      fail(
        cause instanceof Error
          ? cause.message
          : 'Could not start transcription. Please try again.',
      );
    }
  }

  function stop() {
    const current = session.current;
    if (!current || current.stopping) return;
    current.stopping = true;
    clearTimeout(current.timer);
    current.controller.abort();
    const finish = () => {
      if (session.current !== current) return;
      session.current = null;
      current.connection?.close();
      setStatus('idle');
      const { onEnd, ...words } = latest.current;
      onEnd?.(words);
    };
    if (status !== 'listening' || !current.connection) {
      finish();
      return;
    }
    try {
      // Send silence briefly so VAD can finalize the last spoken words before
      // closing the socket. Keep any remaining interim words visible on timeout.
      current.connection.mute();
      setStatus('stopping');
      current.timer = setTimeout(finish, 2_000);
    } catch {
      // The user may cancel before microphone permission has been granted.
      finish();
    }
  }

  function clear() {
    if (session.current) return;
    setSegments([]);
    setPartial('');
    setError('');
  }

  return { status, error, segments, partial, start, stop, clear };
}
