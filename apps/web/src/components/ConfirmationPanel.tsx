import { useState } from 'react';
import type { GoodsReceiptItem } from '@repo/contracts';
import {
  isValidExpiry,
  type GoodsReceiptController,
} from '../hooks/use-goods-receipt';

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
        Position {item.Positionnummer}, article {item.Artikelnummer}
      </span>
    </>
  );
}

// The expiry date, with an inline editor when the worker did not say one.
function ExpiryCell({
  item,
  onSave,
}: {
  item: GoodsReceiptItem;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  if (editing) {
    return (
      <form
        className="expiry-edit"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isValidExpiry(value)) {
            setInvalid(true);
            return;
          }
          onSave(value);
          setEditing(false);
        }}
      >
        <input
          className="code"
          aria-label="Expiry date (MMYYYY)"
          value={value}
          inputMode="numeric"
          placeholder="MMYYYY"
          aria-invalid={invalid}
          onChange={(event) => {
            setValue(event.target.value.replace(/\D/g, '').slice(0, 6));
            setInvalid(false);
          }}
        />
        <button className="btn btn--primary btn--small" type="submit">
          Save
        </button>
        <button
          className="btn btn--ghost btn--small"
          type="button"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
        {invalid && (
          <span className="field-error" role="alert">
            Use MMYYYY, for example 122027.
          </span>
        )}
      </form>
    );
  }
  return (
    <>
      <span className="code">{item.Verfalldatum}</span>
      {item.expiryDefaulted && (
        <button
          className="link-button"
          type="button"
          onClick={() => {
            setValue('');
            setEditing(true);
          }}
        >
          Add expiry date
        </button>
      )}
    </>
  );
}

export function ConfirmationPanel({
  receipt,
  awaitingVoice,
  className,
  onClose,
}: {
  receipt: GoodsReceiptController;
  // True while the app listens for "Done" or "Cancel".
  awaitingVoice: boolean;
  className: string;
  onClose?: (() => void) | undefined;
}) {
  const { result, booking } = receipt;
  const missingCount =
    result.status === 'success'
      ? result.data.items.reduce((sum, item) => sum + item.missing.length, 0)
      : 0;
  const bookable =
    result.status === 'success' &&
    result.data.complete &&
    result.data.bestellungen.length > 0;
  const chip =
    result.status === 'loading'
      ? { tone: 'muted', label: 'Agent is working' }
      : result.status === 'error'
        ? { tone: 'warn', label: 'Needs attention' }
        : result.status === 'success'
          ? result.data.complete
            ? booking.status === 'success' && booking.data.allBooked
              ? { tone: 'ok', label: 'Booked' }
              : { tone: 'ok', label: 'Ready to book' }
            : { tone: 'warn', label: `${missingCount} missing` }
          : { tone: 'muted', label: 'Waiting for words' };

  return (
    <section className={className} aria-labelledby="confirmation-title">
      <div className="panel-head">
        <div className="panel-title">
          <h2 id="confirmation-title">Confirmation</h2>
          <span className={`chip chip--${chip.tone}`}>{chip.label}</span>
        </div>
        <div className="panel-tools">
          {awaitingVoice && (
            <span className="voice-cue" role="status">
              <span className="rays" aria-hidden="true" />
              {bookable ? 'Say “Done” to book or “Cancel”' : 'Listening'}
            </span>
          )}
          {bookable && (
            <button
              className="btn btn--confirm"
              type="button"
              disabled={
                booking.status === 'loading' ||
                (booking.status === 'success' && booking.data.allBooked)
              }
              onClick={() => {
                void receipt.confirm(receipt.bookingsToConfirm());
              }}
            >
              {booking.status === 'loading'
                ? 'Booking…'
                : booking.status === 'success'
                  ? booking.data.allBooked
                    ? 'Booked in ERP'
                    : 'Retry rejected bookings'
                  : 'Confirm and book in ERP'}
            </button>
          )}
          {onClose && (
            <button
              className="btn btn--ghost btn--small"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>
      <div className="panel-body">
        {result.status === 'idle' && (
          <div className="empty">
            <p>Say what arrived and finish with “Done”.</p>
          </div>
        )}
        {result.status === 'loading' && (
          <div className="row-between">
            <p className="hint" role="status">
              Agent is working…
            </p>
            <button
              className="btn btn--ghost btn--small"
              type="button"
              onClick={receipt.cancel}
            >
              Cancel
            </button>
          </div>
        )}
        {result.status === 'error' && (
          <p className="notice notice--error" role="alert">
            {result.message}
          </p>
        )}
        {result.status === 'success' && (
          <>
            <div className="block">
              <div className="row-between">
                <h3>Recognised articles</h3>
                <span className="hint">
                  {result.data.items.length}{' '}
                  {result.data.items.length === 1 ? 'article' : 'articles'}
                </span>
              </div>
              {result.data.items.length > 0 ? (
                <div className="table-scroll">
                  <table
                    className="data-table"
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
                        <th scope="col">Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.items.map((item, index) => (
                        <tr key={index}>
                          <td className="wrap">
                            <ArticleCell item={item} />
                          </td>
                          <td className="num">
                            {item.Zubuchmenge ?? <Missing label="not said" />}
                          </td>
                          <td className="code">
                            {item.Lagerort ?? <Missing label="not said" />}
                          </td>
                          <td className="code">
                            {item.Charge ?? <Missing label="not said" />}
                          </td>
                          <td>
                            <ExpiryCell
                              item={item}
                              onSave={(value) =>
                                receipt.setExpiry(index, value)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint">
                  No article from the order was recognised.
                </p>
              )}
            </div>

            {bookable ? (
              <div className="block">
                <div className="row-between">
                  <h3>Goods receipt to book</h3>
                  <span className="hint">
                    {result.data.bestellungen.length === 1
                      ? 'One booking'
                      : `${result.data.bestellungen.length} bookings, one per position`}
                    , dated {result.data.bestellungen[0]?.Wareneingangsdatum}
                  </span>
                </div>
                <div className="table-scroll">
                  <table
                    className="data-table"
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
                      {result.data.bestellungen.flatMap((entry, index) =>
                        entry.positionen.flatMap((position) =>
                          position.VCS.map((line, lineIndex) => (
                            <tr
                              key={`${index}-${position.Positionnummer}-${lineIndex}`}
                            >
                              <td>{index + 1}</td>
                              <td>{position.Positionnummer}</td>
                              <td className="wrap">
                                {receipt.articleName(position.Positionnummer)}
                                <span className="cell-sub">
                                  {position.Artikelnummer}
                                </span>
                              </td>
                              <td className="code">{position.Lagerort}</td>
                              <td className="num">{line.Menge}</td>
                              <td className="code">{line.Charge}</td>
                              <td className="code">{line.Verfalldatum}</td>
                              <td className="code">{line.Seriennummer}</td>
                              <td className="num">
                                {position.Einkaufpreis.toFixed(2)}
                              </td>
                              <td className="code">
                                {entry.Lieferanten_Rechnungsnummer}
                              </td>
                            </tr>
                          )),
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                {booking.status === 'loading' && (
                  <p className="hint" role="status">
                    Sending to the ERP…
                  </p>
                )}
                {booking.status === 'error' && (
                  <p className="notice notice--error" role="alert">
                    {booking.message}
                  </p>
                )}
                {booking.status === 'success' && (
                  <ul className="results" aria-label="Booking results">
                    {booking.data.results.map((entry, index) => (
                      <li key={index}>
                        <span
                          className={`chip chip--${entry.booked ? 'ok' : 'danger'}`}
                        >
                          {entry.booked ? 'Booked' : 'Not booked'}
                        </span>
                        <span className="result-text">
                          Position {entry.Positionnummer} ·{' '}
                          {receipt.articleName(entry.Positionnummer) ||
                            entry.Artikelnummer}{' '}
                          · {entry.Zubuchmenge} × · booked {entry.bookedBefore}{' '}
                          → {entry.bookedAfter} · invoice{' '}
                          <span className="code">
                            {entry.Lieferanten_Rechnungsnummer}
                          </span>
                        </span>
                        {entry.return.length > 0 && (
                          <ul className="erp-messages">
                            {entry.return.map((message, messageIndex) => (
                              <li key={messageIndex}>
                                <span className="code">
                                  {message.returncode}
                                </span>{' '}
                                {message.message}
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
              <div className="notice notice--warn" role="alert">
                <strong>Nothing to book yet</strong>
                <ul>
                  {result.data.messages.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
