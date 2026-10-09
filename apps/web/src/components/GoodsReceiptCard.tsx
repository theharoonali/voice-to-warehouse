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
  type GoodsReceiptBooking,
  type GoodsReceiptItem,
  type GoodsReceiptOrder,
  type Wareneingang,
} from '@repo/contracts';
import {
  fetchGoodsReceipt,
  fetchGoodsReceiptBooking,
  fetchGoodsReceiptOrder,
} from '../lib/api';

type Result =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GoodsReceipt }
  | { status: 'error'; message: string };

type OrderState =
  | { status: 'loading' }
  | { status: 'success'; order: GoodsReceiptOrder }
  | { status: 'error'; message: string };

type Booking =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GoodsReceiptBooking }
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
  const [booking, setBooking] = useState<Booking>({ status: 'idle' });
  const [copied, setCopied] = useState<number | null>(null);
  const [wasRecording, setWasRecording] = useState(recording);
  const request = useRef<AbortController | null>(null);
  const bookingRequest = useRef<AbortController | null>(null);
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
  useEffect(
    () => () => {
      request.current?.abort();
      bookingRequest.current?.abort();
    },
    [],
  );

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
    setBooking({ status: 'idle' });
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

  // Books the receipts in the ERP through the API, then shows what the ERP
  // answered and the booked quantities it reports afterwards.
  async function confirm(bestellungen: Wareneingang[]) {
    if (bookingRequest.current || bestellungen.length === 0) return;
    const controller = new AbortController();
    bookingRequest.current = controller;
    setBooking({ status: 'loading' });
    try {
      const data = await fetchGoodsReceiptBooking(
        bestellungen,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setBooking({ status: 'success', data });
      setOrder({ status: 'success', order: data.order });
    } catch (error) {
      if (!controller.signal.aborted) {
        setBooking({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Could not book the goods receipt. Please try again.',
        });
      }
    } finally {
      if (bookingRequest.current === controller) bookingRequest.current = null;
    }
  }

  const missingCount =
    result.status === 'success'
      ? result.data.items.reduce((sum, item) => sum + item.missing.length, 0)
      : 0;

  function articleName(positionNumber: number): string {
    if (result.status === 'success') {
      const item = result.data.items.find(
        (candidate) => candidate.Positionnummer === positionNumber,
      );
      if (item?.Artikelbezeichnung) return item.Artikelbezeichnung;
    }
    if (order.status === 'success') {
      const position = order.order.positionen.find(
        (candidate) => candidate.Positionnummer === positionNumber,
      );
      if (position) return position.Artikelbezeichnung;
    }
    return '';
  }

  // After a partial failure, only the rejected positions are sent again.
  function bookingsToConfirm(bestellungen: Wareneingang[]): Wareneingang[] {
    if (booking.status !== 'success') return bestellungen;
    const failed = new Set(
      booking.data.results
        .filter((entry) => !entry.booked)
        .map((entry) => entry.Positionnummer),
    );
    return bestellungen.filter((receipt) =>
      receipt.positionen.some((position) =>
        failed.has(position.Positionnummer),
      ),
    );
  }

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
      <h2 id="goods-receipt-title">Say what arrived. Book it with one tap.</h2>
      <p className="intro">
        Name the article (name or article number), quantity, bin (Lagerort), and
        batch (Charge) for each position. Claude matches your words to the open
        purchase order below, you check the result, and Confirm books it in the
        ERP.
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
              ? 'JSON created. Check the table, then confirm to book it in the ERP.'
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
            <div className="booking">
              <div className="transcript-heading">
                <h3>Goods receipt to book</h3>
                <span className="field-hint">
                  {result.data.bestellungen.length === 1
                    ? 'One booking'
                    : `${result.data.bestellungen.length} bookings, one per position`}
                  {' · order '}
                  {result.data.bestellungen[0]?.Bestellnummer}
                  {' · dated '}
                  {result.data.bestellungen[0]?.Wareneingangsdatum}
                </span>
              </div>
              <div className="order-panel">
                <table
                  className="order-table booking-table"
                  aria-label="Goods receipt to book"
                >
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Pos</th>
                      <th scope="col">Article</th>
                      <th scope="col">Bin</th>
                      <th scope="col" className="num">
                        Qty
                      </th>
                      <th scope="col">Batch</th>
                      <th scope="col">Expiry</th>
                      <th scope="col">Serial</th>
                      <th scope="col" className="num">
                        Price
                      </th>
                      <th scope="col">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.bestellungen.flatMap((receipt, index) =>
                      receipt.positionen.flatMap((position) =>
                        position.VCS.map((entry, entryIndex) => (
                          <tr
                            key={`${index}-${position.Positionnummer}-${entryIndex}`}
                          >
                            <td>{index + 1}</td>
                            <td>{position.Positionnummer}</td>
                            <td className="wrap">
                              {articleName(position.Positionnummer)}
                              <span className="cell-sub">
                                {position.Artikelnummer}
                              </span>
                            </td>
                            <td>{position.Lagerort}</td>
                            <td className="num">{entry.Menge}</td>
                            <td>{entry.Charge}</td>
                            <td>{entry.Verfalldatum}</td>
                            <td>{entry.Seriennummer}</td>
                            <td className="num">
                              {position.Einkaufpreis.toFixed(2)}
                            </td>
                            <td>{receipt.Lieferanten_Rechnungsnummer}</td>
                          </tr>
                        )),
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              {result.data.bestellungen.map((receipt, index) => (
                <details className="json-details" key={index}>
                  <summary>
                    JSON for booking {index + 1} (position{' '}
                    {receipt.positionen[0]?.Positionnummer})
                  </summary>
                  <button
                    className="clear-button"
                    type="button"
                    onClick={() => {
                      void copyJson(index);
                    }}
                  >
                    {copied === index ? 'Copied' : 'Copy JSON'}
                  </button>
                  <pre tabIndex={0} aria-label={`Generated JSON ${index + 1}`}>
                    <code>
                      {JSON.stringify({ bestellung: receipt }, null, 2)}
                    </code>
                  </pre>
                </details>
              ))}
              <div className="booking-actions">
                <button
                  type="button"
                  disabled={
                    booking.status === 'loading' ||
                    (booking.status === 'success' && booking.data.allBooked)
                  }
                  onClick={() => {
                    void confirm(bookingsToConfirm(result.data.bestellungen));
                  }}
                >
                  {booking.status === 'loading'
                    ? 'Booking in ERP…'
                    : booking.status === 'success'
                      ? booking.data.allBooked
                        ? 'Booked in ERP'
                        : 'Retry rejected bookings'
                      : 'Confirm and book in ERP'}
                </button>
                <span className="field-hint" role="status">
                  {booking.status === 'loading'
                    ? 'Sending each booking to the ERP…'
                    : booking.status === 'success'
                      ? booking.data.allBooked
                        ? 'Every position was booked. The order above shows the new quantities.'
                        : 'Some positions were not booked. See the ERP messages below.'
                      : 'Each position is booked with its own call to the ERP.'}
                </span>
              </div>
              {booking.status === 'error' && (
                <p className="transcription-error" role="alert">
                  {booking.message}
                </p>
              )}
              {booking.status === 'success' && (
                <ul className="booking-results" aria-label="Booking results">
                  {booking.data.results.map((entry, index) => (
                    <li key={index}>
                      <span
                        className={entry.booked ? 'badge-ok' : 'badge-fail'}
                      >
                        {entry.booked ? '✓ Booked' : '✗ Not booked'}
                      </span>{' '}
                      Position {entry.Positionnummer} ·{' '}
                      {articleName(entry.Positionnummer) || entry.Artikelnummer}{' '}
                      · {entry.Zubuchmenge} units · booked {entry.bookedBefore}{' '}
                      → {entry.bookedAfter} · invoice{' '}
                      {entry.Lieferanten_Rechnungsnummer}
                      {entry.return.length > 0 && (
                        <ul className="erp-messages">
                          {entry.return.map((message, messageIndex) => (
                            <li key={messageIndex}>
                              {message.returncode}: {message.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
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
