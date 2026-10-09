import { useEffect, useRef, useState } from 'react';
import { useGoodsReceipt } from '../hooks/use-goods-receipt';
import { useMediaQuery } from '../hooks/use-media-query';
import {
  useTranscription,
  type Language,
  type RecordedWords,
} from '../hooks/use-transcription';
import {
  endsWithCancel,
  endsWithDone,
  stripCommandWords,
} from '../lib/voice-commands';
import { CapturePanel } from './CapturePanel';
import { ConfirmationPanel } from './ConfirmationPanel';
import { OrderPanel } from './OrderPanel';

// Below this width the confirmation opens as a sheet over the capture panel.
const MOBILE_QUERY = '(max-width: 959px)';

// capture: the words become a receipt. confirm: a receipt is shown and the
// app listens for "Done" (book it), "Cancel" (discard it) or new words.
type Mode = 'capture' | 'confirm';

export function VoiceTranscriber() {
  const [language, setLanguage] = useState<Language>('en');
  const [mode, setMode] = useState<Mode>('capture');
  const [cancelled, setCancelled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const doneRequested = useRef(false);
  const cancelRequested = useRef(false);
  // The hooks call these when a recording ends or a receipt was created. They
  // are refreshed after every render so they see the latest state.
  const handlers = useRef<{
    end: (words: RecordedWords) => void;
    created: () => void;
  }>({
    end: () => {},
    created: () => {},
  });

  const { status, error, segments, partial, start, stop } = useTranscription(
    language,
    { onEnd: (words) => handlers.current.end(words) },
  );
  const receipt = useGoodsReceipt({
    onCreated: () => handlers.current.created(),
  });
  const mobile = useMediaQuery(MOBILE_QUERY);
  const active = status !== 'idle';
  const bookable =
    receipt.result.status === 'success' &&
    receipt.result.data.complete &&
    receipt.result.data.bestellungen.length > 0;

  useEffect(() => {
    handlers.current = {
      // Once a receipt is shown, listen for the worker's confirmation.
      created: () => {
        setMode('confirm');
        void start();
      },
      // While capturing, the words become a receipt. While confirming, "Done"
      // books the receipt, "Cancel" discards it, and new words replace it.
      end: (recorded) => {
        const done = doneRequested.current;
        const cancel = cancelRequested.current;
        doneRequested.current = false;
        cancelRequested.current = false;
        const words = stripCommandWords(
          [...recorded.segments, recorded.partial].filter(Boolean).join(' '),
        );
        if (cancel) {
          // "Cancel" starts over: no result, no booking, fresh open positions.
          receipt.reset();
          setCancelled(true);
          setMode('capture');
          setSheetOpen(false);
          return;
        }
        setCancelled(false);
        setMode('capture');
        // A complete receipt waits for "Done": other words are ignored until
        // then. An incomplete one is replaced by the words said before "Done".
        if (mode === 'confirm' && bookable) {
          if (done) void receipt.confirm(receipt.bookingsToConfirm());
          return;
        }
        if (words) void receipt.create(words);
      },
    };
  });

  // A new result opens the confirmation sheet on small screens.
  const [seenResult, setSeenResult] = useState(receipt.result);
  if (receipt.result !== seenResult) {
    setSeenResult(receipt.result);
    if (
      receipt.result.status === 'success' ||
      receipt.result.status === 'error'
    )
      setSheetOpen(true);
  }

  // The space bar starts a recording (and stops one), unless the user is
  // typing in a field.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.code !== 'Space' ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      event.preventDefault();
      if (status === 'idle') void start();
      else if (status === 'listening') stop();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, start, stop]);

  // "Done" (or "Fertig") and "Cancel" (or "Abbrechen") end the recording the
  // moment they appear in the live words, without waiting for the sentence to
  // be finalized.
  useEffect(() => {
    if (status !== 'listening') return;
    const latest = partial || segments.at(-1);
    if (!latest) return;
    if (endsWithCancel(latest)) {
      cancelRequested.current = true;
      stop(true);
    } else if (endsWithDone(latest)) {
      doneRequested.current = true;
      stop(true);
    }
  }, [status, segments, partial, stop]);

  const confirming = mode === 'confirm' && status === 'listening';

  const confirmation = (className: string, onClose?: () => void) => (
    <ConfirmationPanel
      receipt={receipt}
      awaitingVoice={confirming}
      className={className}
      onClose={onClose}
    />
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img
            className="brand-mark"
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
          />
          <div className="brand-text">
            <strong>ANVY</strong>
            <span>AI-powered goods receipt</span>
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Speaking language">
          <button
            type="button"
            aria-pressed={language === 'en'}
            disabled={active}
            onClick={() => setLanguage('en')}
          >
            EN
          </button>
          <button
            type="button"
            aria-pressed={language === 'de'}
            disabled={active}
            onClick={() => setLanguage('de')}
          >
            DE
          </button>
        </div>
      </header>

      <main className="workspace">
        <CapturePanel
          status={status}
          error={error}
          segments={segments}
          partial={partial}
          language={language}
          cancelled={cancelled}
          confirming={confirming}
          onStart={start}
          onStop={stop}
        />
        {!mobile && confirmation('panel panel--confirm')}
        <OrderPanel order={receipt.order} />
      </main>

      {mobile && !sheetOpen && receipt.result.status !== 'idle' && (
        <button
          className="btn btn--primary sheet-launcher"
          type="button"
          onClick={() => setSheetOpen(true)}
        >
          Show confirmation
        </button>
      )}
      {mobile && sheetOpen && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirmation-title"
        >
          <button
            className="sheet-backdrop"
            type="button"
            aria-label="Close confirmation"
            onClick={() => setSheetOpen(false)}
          />
          {confirmation('sheet-panel', () => setSheetOpen(false))}
        </div>
      )}
    </div>
  );
}
