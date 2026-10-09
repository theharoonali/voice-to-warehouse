import type { Language } from '../hooks/use-transcription';

type Status = 'idle' | 'connecting' | 'listening' | 'stopping';

// The caption under the microphone is one line: the tail of the latest words.
const CAPTION_LENGTH = 64;

function captionFor(partial: string, segments: string[]): string {
  const text = partial || segments.at(-1) || '';
  return text.length > CAPTION_LENGTH
    ? `…${text.slice(-(CAPTION_LENGTH - 1))}`
    : text;
}

export function CapturePanel({
  status,
  error,
  segments,
  partial,
  language,
  cancelled,
  confirming,
  onStart,
  onStop,
}: {
  status: Status;
  error: string;
  segments: string[];
  partial: string;
  language: Language;
  cancelled: boolean;
  confirming: boolean;
  onStart: () => Promise<void>;
  onStop: () => void;
}) {
  const active = status !== 'idle';
  const statusText =
    status === 'connecting'
      ? 'Connecting'
      : status === 'listening'
        ? confirming
          ? 'Listening for “Done”'
          : 'Listening'
        : status === 'stopping'
          ? 'Finishing'
          : cancelled
            ? 'Cancelled'
            : 'Ready';
  const caption = captionFor(partial, segments);

  return (
    <section className="panel panel--capture" aria-labelledby="capture-title">
      <div className="panel-head">
        <h2 id="capture-title">Agent</h2>
        <span
          className={`status-line${status === 'listening' ? ' status-line--live' : ''}`}
          role="status"
        >
          <span className="status-dot" aria-hidden="true" />
          {statusText}
        </span>
      </div>
      <div className="panel-body panel-body--capture">
        <div className={`mic-stage mic-stage--${status}`}>
          <button
            className={`mic-button${active ? ' mic-button--active' : ''}`}
            type="button"
            onClick={() => (active ? onStop() : void onStart())}
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
                  rx="2"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect
                  x="8.5"
                  y="2.5"
                  width="7"
                  height="12"
                  rx="3.5"
                  fill="currentColor"
                />
                <path
                  d="M5.5 11a6.5 6.5 0 0 0 13 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M12 17.5V21"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
          {/* Each change of the words restarts the caption, which fades out on its own. */}
          <p
            className="caption"
            key={`${active ? 'live' : 'ended'}:${caption}`}
            aria-live="polite"
            aria-atomic="true"
            lang={language}
          >
            {active ? caption : ''}
          </p>
        </div>
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
