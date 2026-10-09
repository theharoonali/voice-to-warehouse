import type { OrderState } from '../hooks/use-goods-receipt';

export function OrderPanel({ order }: { order: OrderState }) {
  return (
    <section className="panel panel--orders" aria-labelledby="orders-title">
      <div className="panel-head">
        <div className="panel-title">
          <h2 id="orders-title">Open Positions</h2>
          {order.status === 'success' && (
            <span className="chip chip--muted">
              {order.order.Bestellstatus}
            </span>
          )}
        </div>
        <span className="hint">
          {order.status === 'loading'
            ? 'Loading from the ERP'
            : order.status === 'success'
              ? `${order.order.positionen.length} positions`
              : 'Not available'}
        </span>
      </div>
      <div className="panel-body panel-body--flush">
        {order.status === 'success' && (
          <table className="data-table" aria-label="Open Positions">
            <thead>
              <tr>
                <th scope="col">Pos</th>
                <th scope="col" className="artnr">
                  Article number
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
                  className={position.Restmenge > 0 ? undefined : 'row--done'}
                >
                  <td>{position.Positionnummer}</td>
                  <td className="artnr code">{position.Artikelnummer}</td>
                  <td className="wrap">{position.Artikelbezeichnung}</td>
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
          <p className="notice notice--error" role="alert">
            {order.message}
          </p>
        )}
      </div>
    </section>
  );
}
