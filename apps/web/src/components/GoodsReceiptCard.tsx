import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type SubmitEvent,
} from 'react';
import {
  goodsReceiptRequestSchema,
  type GoodsReceipt,
  type GoodsReceiptItem,
  type GoodsReceiptOrder,
} from '@repo/contracts';
import { fetchGoodsReceipt, fetchGoodsReceiptOrder } from '../lib/api';

type Result =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GoodsReceipt }
  | { status: 'error'; message: string };

type OrderState =
  | { status: 'loading' }
  | { status: 'success'; order: GoodsReceiptOrder }
  | { status: 'error'; message: string };

const EXAMPLE_TEXT =
  'One pack of Ibuflam 600mg in bin M53-01-01-02, batch AB1234, expiry December 2027. Two Samsung RAM modules in bin M53-02-01-01, batch HS77. Please book them in.';

function Missing({ label }: { label: string }) {
  return (
    <span className="cross" role="img" aria-label={`Missing: ${label}`}>
      <span aria-hidden="true">✗</span> {label}
    </span>
  );
}

function ArticleCell({ item }: { item: GoodsReceiptItem }) {
  if (item.Artikelbezeichnung === null) {
    return (
      <>
        <Missing label="not in the order" />
        <span className="cell-sub">“{item.spoken}”</span>
      </>
    );
  }
  return (
    <>
      {item.Artikelbezeichnung}
      <span className="cell-sub">
        Pos {item.Positionnummer} · {item.Artikelnummer}
      </span>
    </>
  );
}

export type GoodsReceiptCardHandle = {
  // Fills the text field and creates the JSON, used when the worker says "Done".
  create: (text: string) => void;
};

export function GoodsReceiptCard({
  ref,
  transcript,
  recording,
}: {
  ref?: Ref<GoodsReceiptCardHandle>;
  transcript: string;
  recording: boolean;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result>({ status: 'idle' });
  const [order, setOrder] = useState<OrderState>({ status: 'loading' });
  const [copied, setCopied] = useState<number | null>(null);
  const [wasRecording, setWasRecording] = useState(recording);
  const request = useRef<AbortController | null>(null);
  const loading = result.status === 'loading';

  // When a recording finishes, its transcript becomes the text to convert.
  // Nothing is sent until the user selects the button.
  if (recording !== wasRecording) {
    setWasRecording(recording);
    if (!recording && transcript.trim()) {
      setText(transcript);
      setResult({ status: 'idle' });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchGoodsReceiptOrder(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setOrder({ status: 'success', order: data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setOrder({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Could not load the purchase order.',
          });
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => () => request.current?.abort(), []);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void createFromText(text);
  }

  async function createFromText(value: string) {
    if (request.current) return;
    const parsed = goodsReceiptRequestSchema.safeParse({ text: value });
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
    setCopied(null);
    try {
      const data = await fetchGoodsReceipt(
        parsed.data.text,
        order.status === 'success' ? order.order : null,
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

  useImperativeHandle(ref, () => ({
    create: (value: string) => {
      setText(value);
      void createFromText(value);
    },
  }));

  async function copyJson(index: number) {
    if (result.status !== 'success') return;
    const receipt = result.data.bestellungen[index];
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ bestellung: receipt }, null, 2),
      );
      setCopied(index);
    } catch {
      setCopied(null);
    }
  }

  const missingCount =
    result.status === 'success'
      ? result.data.items.reduce((sum, item) => sum + item.missing.length, 0)
      : 0;

  return (
    <section
      className="voice-card structured-card"
      aria-labelledby="goods-receipt-title"
    >
      <div className="card-heading">
        <p className="eyebrow">FROM WORDS TO WARENEINGANG</p>
        <span className="service-badge">
          Claude · ERP order{' '}
          {order.status === 'success' ? order.order.Bestellnummer : '…'}
        </span>
      </div>
      <h2 id="goods-receipt-title">Say what arrived. Get the booking JSON.</h2>
      <p className="intro">
        Name the article (name or article number), quantity, bin (Lagerort), and
        batch (Charge) for each position. Claude matches your words to the open
        purchase order below and builds the goods receipt JSON with the ERP
        position numbers and prices.
      </p>

      <div className="order-panel">
        <div className="transcript-heading">
          <h3>Open order positions</h3>
          <span className="field-hint">
            {order.status === 'loading'
              ? 'Loading from the ERP…'
              : order.status === 'success'
                ? `${order.order.positionen.length} positions · ${order.order.Bestellstatus}`
                : 'Not available'}
          </span>
        </div>
        {order.status === 'success' && (
          <table className="order-table" aria-label="Open order positions">
            <thead>
              <tr>
                <th scope="col">Pos</th>
                <th scope="col" className="artnr">
                  Artikelnummer
                </th>
                <th scope="col">Article</th>
                <th scope="col" className="num qty">
                  Ordered
                </th>
                <th scope="col" className="num qty">
                  Booked
                </th>
                <th scope="col" className="num">
                  Remaining
                </th>
              </tr>
            </thead>
            <tbody>
              {order.order.positionen.map((position) => (
                <tr
                  key={position.Positionnummer}
                  className={
                    position.Restmenge > 0 ? undefined : 'order-row--done'
                  }
                >
                  <td>{position.Positionnummer}</td>
                  <td className="artnr">{position.Artikelnummer}</td>
                  <td>{position.Artikelbezeichnung}</td>
                  <td className="num qty">{position.Bestellmenge}</td>
                  <td className="num qty">{position.Bereitszugebuchtemenge}</td>
                  <td className="num remaining">
                    {position.Restmenge > 0
                      ? position.Restmenge
                      : 'fully booked'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {order.status === 'error' && (
          <p className="transcription-error" role="alert">
            {order.message}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="transcript-heading">
          <label htmlFor="goods-receipt-text">What arrived</label>
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
          id="goods-receipt-text"
          placeholder={EXAMPLE_TEXT}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult({ status: 'idle' });
          }}
          rows={4}
          maxLength={8_000}
          required
          disabled={loading}
          aria-describedby="goods-receipt-hint"
        />
        <p id="goods-receipt-hint" className="field-hint">
          Say “Done” at the end of a recording and the JSON is created
          automatically; a recording stopped by hand only fills this field.
          Required per article: name or article number, quantity, bin, and
          batch; the expiry date (Verfalldatum) is optional. Several articles in
          one text are fine.
        </p>
        <div className="structured-actions">
          <button type="submit" disabled={loading || !text.trim()}>
            {loading ? 'Creating JSON…' : 'Create goods receipt JSON'}
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
          ? 'Asking Claude…'
          : result.status === 'success'
            ? result.data.complete
              ? 'JSON created. Every article has all required details.'
              : `${missingCount} detail${missingCount === 1 ? '' : 's'} missing. The JSON is created only when everything is said.`
            : 'Text is sent to Claude only when you select Create goods receipt JSON.'}
      </p>
      {result.status === 'error' && (
        <p className="transcription-error" role="alert">
          {result.message}
        </p>
      )}
      {result.status === 'success' && (
        <>
          <div className="review">
            <div className="transcript-heading">
              <h3>Recognised articles</h3>
              <span className="field-hint">
                {result.data.complete ? 'Complete' : 'Details missing'}
              </span>
            </div>
            {result.data.items.length > 0 ? (
              <table
                className="order-table review-table"
                aria-label="Recognised articles"
              >
                <thead>
                  <tr>
                    <th scope="col">Article</th>
                    <th scope="col" className="num">
                      Quantity
                    </th>
                    <th scope="col">Bin</th>
                    <th scope="col">Batch</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <ArticleCell item={item} />
                      </td>
                      <td className="num">
                        {item.Zubuchmenge ?? <Missing label="not said" />}
                      </td>
                      <td>{item.Lagerort ?? <Missing label="not said" />}</td>
                      <td>
                        {item.Charge ?? <Missing label="not said" />}
                        <span className="cell-sub">
                          Expiry {item.Verfalldatum}
                          {item.expiryDefaulted ? ' (default, not said)' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="field-hint">No article was recognised.</p>
            )}
          </div>
          {result.data.complete && result.data.bestellungen.length > 0 ? (
            <div className="json-result">
              <div className="transcript-heading">
                <h3>Wareneingang JSON</h3>
                <span className="field-hint">
                  {result.data.bestellungen.length === 1
                    ? 'One booking'
                    : `${result.data.bestellungen.length} separate bookings, one per position`}
                </span>
              </div>
              {result.data.bestellungen.map((receipt, index) => {
                const position = receipt.positionen[0];
                return (
                  <div className="json-block" key={index}>
                    <div className="transcript-heading">
                      <h4>
                        Booking {index + 1} of {result.data.bestellungen.length}
                        {position
                          ? ` · Position ${position.Positionnummer} · ${position.Artikelnummer}`
                          : ''}
                      </h4>
                      <button
                        className="clear-button"
                        type="button"
                        onClick={() => {
                          void copyJson(index);
                        }}
                      >
                        {copied === index ? 'Copied' : 'Copy JSON'}
                      </button>
                    </div>
                    <pre
                      tabIndex={0}
                      aria-label={`Generated JSON ${index + 1}`}
                    >
                      <code>
                        {JSON.stringify({ bestellung: receipt }, null, 2)}
                      </code>
                    </pre>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="missing-box" role="alert">
              <strong>No JSON yet</strong>
              <ul>
                {result.data.messages.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
              <p>
                Say the missing details and create the JSON again. It is only
                created when every article has an article number, quantity, bin,
                and batch.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
