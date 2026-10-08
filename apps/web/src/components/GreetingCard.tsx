import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { greetingQuerySchema, type Greeting } from '@repo/contracts';
import { fetchGreeting } from '../lib/api';

type GreetingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; greeting: Greeting }
  | { status: 'error'; message: string };

export function GreetingCard() {
  const [name, setName] = useState('World');
  const [state, setState] = useState<GreetingState>({ status: 'idle' });
  const request = useRef<AbortController | null>(null);
  const loading = state.status === 'loading';

  useEffect(() => () => request.current?.abort(), []);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    request.current?.abort();
    const query = greetingQuerySchema.safeParse({ name });

    if (!query.success) {
      setState({
        status: 'error',
        message: query.error.issues[0]?.message ?? 'Please enter a valid name.',
      });
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setState({ status: 'loading' });

    try {
      const greeting = await fetchGreeting(query.data, controller.signal);
      if (!controller.signal.aborted) setState({ status: 'success', greeting });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not reach the API. Please try again.',
      });
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          vw
        </span>{' '}
        Voice to Warehouse
      </header>
      <section className="greeting-card" aria-labelledby="greeting-title">
        <p className="eyebrow">A SMALL START. A SOLID FOUNDATION.</p>
        <h1 id="greeting-title">
          Good things start
          <br />
          with a hello<span>.</span>
        </h1>
        <p className="intro">
          Your React app and Express API, connected. Send a name and get a
          little welcome back.
        </p>

        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <label htmlFor="name">Your name</label>
          <div className="form-row">
            <input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoComplete="given-name"
              disabled={loading}
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Saying hello…' : 'Say hello'}
              <span aria-hidden="true"> ↗</span>
            </button>
          </div>
        </form>

        <div
          className={`response response--${state.status}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-busy={loading}
        >
          <span className="response-label">
            {state.status === 'success'
              ? 'MESSAGE RECEIVED'
              : state.status === 'error'
                ? 'LET’S TRY AGAIN'
                : 'YOUR WELCOME MESSAGE'}
          </span>
          <p>
            {state.status === 'success'
              ? state.greeting.message
              : state.status === 'error'
                ? state.message
                : loading
                  ? 'Waiting for your greeting…'
                  : 'A friendly hello is one click away.'}
          </p>
          {state.status === 'success' && (
            <time dateTime={state.greeting.generatedAt}>
              Received at{' '}
              {new Date(state.greeting.generatedAt).toLocaleTimeString()}
            </time>
          )}
        </div>
        <footer className="card-footer">
          <span className="connection-dot" aria-hidden="true" /> One simple
          connection. Room to grow.
        </footer>
      </section>
      <footer className="page-footer">
        Built with React <span> / </span> Express <span> / </span> Turborepo
      </footer>
    </main>
  );
}
