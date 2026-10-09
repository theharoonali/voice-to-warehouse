import type {
  ErpReturn,
  GoodsReceiptBooking,
  GoodsReceiptBookingResult,
  GoodsReceiptOrder,
  Wareneingang,
} from '@repo/contracts';
import { env } from '../config/env.js';
import { fetchErpOrder, putErpGoodsReceipt } from '../erp/client.js';
import { HttpError } from '../errors/http-error.js';
import { toOrderSummary } from './goods-receipt.service.js';

// IMP015 adds this code when the receipt was not accepted.
const REJECTED_CODE = 'RTC100';
// Used in place of ERP return codes when the booking call itself failed.
const CALL_FAILED_CODE = 'API';

function bookedQuantities(
  positionen: { Positionnummer: number; Bereitszugebuchtemenge: number }[],
) {
  return new Map(
    positionen.map((position) => [
      position.Positionnummer,
      position.Bereitszugebuchtemenge,
    ]),
  );
}

function assertBookable(bestellungen: Wareneingang[]) {
  for (const bestellung of bestellungen) {
    if (
      bestellung.Bestellnummer !== env.ERP_BESTELLNUMMER ||
      bestellung.Firma !== env.ERP_FIRMA
    ) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `Only order ${env.ERP_BESTELLNUMMER} of company ${env.ERP_FIRMA} can be booked.`,
      );
    }
  }
}

async function bookInErp(
  bestellungen: Wareneingang[],
  signal?: AbortSignal,
): Promise<GoodsReceiptBooking> {
  const before = bookedQuantities(
    toOrderSummary(await fetchErpOrder(env.ERP_BESTELLNUMMER, signal))
      .positionen,
  );

  // Book one receipt after the other. A rejected or failed call does not stop
  // the rest; the order is read again afterwards to see what was booked.
  const answers: ErpReturn[][] = [];
  for (const bestellung of bestellungen) {
    try {
      answers.push(await putErpGoodsReceipt(bestellung, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      answers.push([
        {
          returncode: CALL_FAILED_CODE,
          message:
            error instanceof HttpError
              ? `${error.message} Whether this position was booked is shown by the quantities.`
              : 'The booking call failed. Whether this position was booked is shown by the quantities.',
        },
      ]);
    }
  }

  // The ERP's return codes do not say what was booked, so read the order again
  // and compare the booked quantities.
  const order = toOrderSummary(
    await fetchErpOrder(env.ERP_BESTELLNUMMER, signal),
  );
  const after = bookedQuantities(order.positionen);
  const rejected = answers.map((answer) =>
    answer.some((entry) => entry.returncode === REJECTED_CODE),
  );
  // Several receipts may book the same position; compare the summed quantity.
  const expected = new Map<number, number>();
  bestellungen.forEach((bestellung, index) => {
    if (rejected[index]) return;
    for (const position of bestellung.positionen) {
      expected.set(
        position.Positionnummer,
        (expected.get(position.Positionnummer) ?? 0) + position.Zubuchmenge,
      );
    }
  });

  const results: GoodsReceiptBookingResult[] = bestellungen.flatMap(
    (bestellung, index) =>
      bestellung.positionen.map((position) => {
        const was = before.get(position.Positionnummer) ?? 0;
        const now = after.get(position.Positionnummer) ?? 0;
        return {
          Positionnummer: position.Positionnummer,
          Artikelnummer: position.Artikelnummer,
          Zubuchmenge: position.Zubuchmenge,
          Lieferanten_Rechnungsnummer: bestellung.Lieferanten_Rechnungsnummer,
          booked:
            !rejected[index] &&
            now > was &&
            now - was >= (expected.get(position.Positionnummer) ?? 0),
          bookedBefore: was,
          bookedAfter: now,
          return: answers[index] ?? [],
        };
      }),
  );

  return {
    allBooked: results.length > 0 && results.every((result) => result.booked),
    results,
    order,
  };
}

// Demo mode: every position is reported as booked. Positions the ERP did not
// book get the quantities they would have had, so the screen stays coherent.
function presentAsBooked(
  real: GoodsReceiptBooking | null,
  bestellungen: Wareneingang[],
): GoodsReceiptBooking {
  const notBooked = new Map<number, number>();
  const results: GoodsReceiptBookingResult[] = bestellungen.flatMap(
    (bestellung) =>
      bestellung.positionen.map((position) => {
        const actual = real?.results.find(
          (entry) =>
            entry.Positionnummer === position.Positionnummer &&
            entry.Lieferanten_Rechnungsnummer ===
              bestellung.Lieferanten_Rechnungsnummer,
        );
        if (actual?.booked) return actual;
        const was = actual?.bookedBefore ?? 0;
        notBooked.set(
          position.Positionnummer,
          (notBooked.get(position.Positionnummer) ?? 0) + position.Zubuchmenge,
        );
        return {
          Positionnummer: position.Positionnummer,
          Artikelnummer: position.Artikelnummer,
          Zubuchmenge: position.Zubuchmenge,
          Lieferanten_Rechnungsnummer: bestellung.Lieferanten_Rechnungsnummer,
          booked: true,
          bookedBefore: was,
          bookedAfter: was + position.Zubuchmenge,
          return: [],
        };
      }),
  );
  const order: GoodsReceiptOrder | null = real?.order
    ? {
        ...real.order,
        positionen: real.order.positionen.map((position) => {
          const extra = notBooked.get(position.Positionnummer) ?? 0;
          if (!extra) return position;
          const booked = position.Bereitszugebuchtemenge + extra;
          return {
            ...position,
            Bereitszugebuchtemenge: booked,
            Restmenge: Math.max(0, position.Bestellmenge - booked),
          };
        }),
      }
    : null;
  return { allBooked: true, results, order };
}

export async function bookGoodsReceipts(
  bestellungen: Wareneingang[],
  signal?: AbortSignal,
): Promise<GoodsReceiptBooking> {
  assertBookable(bestellungen);
  if (!env.ERP_BOOKING_ALWAYS_OK) return bookInErp(bestellungen, signal);

  try {
    const real = await bookInErp(bestellungen, signal);
    if (!real.allBooked) {
      console.error(
        'Booking reported as successful (ERP_BOOKING_ALWAYS_OK) although the ERP did not book:',
        JSON.stringify(real.results.filter((entry) => !entry.booked)),
      );
    }
    return presentAsBooked(real, bestellungen);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error(
      'Booking reported as successful (ERP_BOOKING_ALWAYS_OK) although it failed:',
      error instanceof Error ? error.message : String(error),
    );
    return presentAsBooked(null, bestellungen);
  }
}
