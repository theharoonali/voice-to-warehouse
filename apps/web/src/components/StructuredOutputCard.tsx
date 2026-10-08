import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  structuredOutputRequestSchema,
  type StructuredOutput,
} from '@repo/contracts';
import { fetchStructuredOutput } from '../lib/api';

type Result =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: StructuredOutput }
  | { status: 'error'; message: string };

export function StructuredOutputCard({
  transcript,
  recording,
}: {
  transcript: string;
  recording: boolean;
}) {
  const [text, setText] = useState(
    'Urgently move 3 boxes of screws from aisle A to warehouse 5.',
  );
  const [result, setResult] = useState<Result>({ status: 'idle' });
  const request = useRef<AbortController | null>(null);
  const loading = result.status === 'loading';
  useEffect(() => () => request.current?.abort(), []);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const parsed = structuredOutputRequestSchema.safeParse({ text });
    if (!parsed.success) {
      setResult({
        status: 'error',
        message: parsed.error.issues[0]?.message ?? 'Enter some text.',
      });
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setResult({ status: 'loading' });
    try {
      const data = await fetchStructuredOutput(
        parsed.data.text,
        controller.signal,
      );
      if (!controller.signal.aborted) setResult({ status: 'success', data });
    } catch (error) {
      if (!controller.signal.aborted) {
        setResult({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Could not reach the API. Please try again.',
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function cancel() {
    request.current?.abort();
    request.current = null;
    setResult({ status: 'idle' });
  }

  return (
    <section
      className="voice-card structured-card"
      aria-labelledby="structured-title"
    >
      <div className="card-heading">
        <p className="eyebrow">FROM WORDS TO DATA</p>
        <span className="service-badge">Claude · JSON demo</span>
      </div>
      <h2 id="structured-title">Give your words a structure.</h2>
      <p className="intro">
        Enter a request or use your voice transcript. Claude returns a JSON
        object with strings, numbers, booleans, arrays, and nested fields.
      </p>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <div className="transcript-heading">
          <label htmlFor="structured-text">Text to convert</label>
          <button
            className="clear-button"
            type="button"
            disabled={loading || recording || !transcript.trim()}
            onClick={() => {
              setText(transcript);
              setResult({ status: 'idle' });
            }}
          >
            Use transcript
          </button>
        </div>
        <textarea
          id="structured-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult({ status: 'idle' });
          }}
          rows={4}
          maxLength={8_000}
          required
          disabled={loading}
          aria-describedby="structured-hint"
        />
        <p id="structured-hint" className="field-hint">
          English and German supported. This demo interprets your request; it
          does not change warehouse records.
        </p>
        <div className="structured-actions">
          <button type="submit" disabled={loading || !text.trim()}>
            {loading ? 'Generating JSON…' : 'Generate JSON'}
          </button>
          {loading && (
            <button type="button" className="clear-button" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <p className="field-hint" role="status">
        {loading
          ? 'Waiting for Claude…'
          : result.status === 'success'
            ? 'JSON generated and validated.'
            : 'Text is sent to Claude only when you select Generate JSON.'}
      </p>
      {result.status === 'error' && (
        <p className="transcription-error" role="alert">
          {result.message}
        </p>
      )}
      {result.status === 'success' && (
        <div className="json-result">
          <h3>JSON response</h3>
          <pre tabIndex={0} aria-label="Generated JSON">
            <code>{JSON.stringify(result.data, null, 2)}</code>
          </pre>
        </div>
      )}
    </section>
  );
}
