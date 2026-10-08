import { useEffect, useRef, useState } from 'react';
import { useTranscription, type Language } from '../hooks/use-transcription';
import { StructuredOutputCard } from './StructuredOutputCard';

export function VoiceTranscriber() {
  const [language, setLanguage] = useState<Language>('en');
  const { status, error, segments, partial, start, stop, clear } =
    useTranscription(language);
  const transcript = useRef<HTMLDivElement>(null);
  const active = status !== 'idle';
  const hasText = segments.length > 0 || Boolean(partial);

  useEffect(() => {
    if (transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [segments, partial]);

  const statusText =
    status === 'connecting'
      ? 'Connecting · allow microphone access'
      : status === 'listening'
        ? 'Listening · speak naturally'
        : status === 'stopping'
          ? 'Finishing your last words…'
          : hasText
            ? 'Recording complete'
            : 'Ready when you are';

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          vw
        </span>
        Voice to Warehouse
        <span className="brand-tag">VOICE WORKSPACE</span>
      </header>
      <section className="voice-card" aria-labelledby="voice-title">
        <div className="card-heading">
          <p className="eyebrow">LESS TYPING. MORE DOING.</p>
          <span className="service-badge">Live transcription</span>
        </div>
        <h1 id="voice-title">
          Your voice.
          <br />
          In words<span>.</span>
        </h1>
        <p className="intro">
          Speak naturally and watch your words appear. Capture every detail, one
          sentence at a time.
        </p>

        <div className="language-row">
          <label htmlFor="language">Speaking language</label>
          <select
            id="language"
            value={language}
            disabled={active}
            onChange={(event) => setLanguage(event.target.value as Language)}
            aria-describedby="language-hint"
          >
            <option value="en">English</option>
            <option value="de">Deutsch (German)</option>
          </select>
        </div>
        <p id="language-hint" className="field-hint">
          {active
            ? 'Stop recording to change the language.'
            : 'Choose the language you’ll speak. Your words stay in that language.'}
        </p>

        <div className={`voice-stage voice-stage--${status}`}>
          <div className="voice-rings">
            <button
              className="mic-button"
              type="button"
              onClick={() => (active ? stop() : void start())}
              disabled={status === 'stopping'}
              aria-label={active ? 'Stop recording' : 'Start recording'}
              aria-pressed={active}
            >
              {active ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect
                    x="6"
                    y="6"
                    width="12"
                    height="12"
                    rx="3"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
                </svg>
              )}
            </button>
          </div>
          <p className="mic-label">
            {status === 'connecting'
              ? 'Cancel connection'
              : status === 'stopping'
                ? 'Finishing recording'
                : active
                  ? 'Tap to stop'
                  : hasText
                    ? 'Start a new recording'
                    : 'Tap to start speaking'}
          </p>
          <p className="recording-status" role="status">
            <span
              className={`status-dot ${status === 'listening' ? 'status-dot--live' : ''}`}
              aria-hidden="true"
            />
            {statusText}
          </p>
          <div
            className="subtitle"
            aria-live="polite"
            aria-atomic="true"
            lang={language}
          >
            {partial ||
              segments.at(-1) ||
              (status === 'listening'
                ? 'Your words will appear here…'
                : 'A little space for what you have to say.')}
          </div>
        </div>

        {error && (
          <p className="transcription-error" role="alert">
            {error}
          </p>
        )}

        <section
          className="transcript-panel"
          aria-labelledby="transcript-title"
        >
          <div className="transcript-heading">
            <h2 id="transcript-title">Your transcript</h2>
            <button
              className="clear-button"
              type="button"
              onClick={clear}
              disabled={active || !hasText}
            >
              Clear
            </button>
          </div>
          <div
            className="transcript-text"
            ref={transcript}
            tabIndex={0}
            lang={language}
            aria-label="Transcript"
          >
            {hasText ? (
              <p>
                {segments.join(' ')}
                {segments.length > 0 && partial ? ' ' : ''}
                <span className="interim-text">{partial}</span>
              </p>
            ) : (
              <p className="empty-transcript">
                Your conversation takes shape here. Start the microphone to
                begin.
              </p>
            )}
          </div>
          {partial && status === 'idle' && (
            <p className="field-hint">
              The lighter text is the last live preview; it was not finalized.
            </p>
          )}
        </section>
        <footer className="card-footer">
          Audio is streamed to ElevenLabs while recording. A new recording
          starts a fresh transcript.
        </footer>
      </section>
      <StructuredOutputCard
        transcript={[...segments, partial].filter(Boolean).join(' ')}
        recording={active}
      />
      <footer className="page-footer">
        Powered by ElevenLabs <span>/</span> English &amp; German
      </footer>
    </main>
  );
}
