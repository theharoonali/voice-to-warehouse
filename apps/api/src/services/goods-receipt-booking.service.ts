import type {
  ErpReturn,
  GoodsReceiptBooking,
  GoodsReceiptBookingResult,
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

export async function bookGoodsReceipts(
  bestellungen: Wareneingang[],
  signal?: AbortSignal,
): Promise<GoodsReceiptBooking> {
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
