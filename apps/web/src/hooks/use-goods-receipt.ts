import { useEffect, useRef, useState } from 'react';
import {
  goodsReceiptRequestSchema,
  type GoodsReceipt,
  type GoodsReceiptBooking,
  type GoodsReceiptOrder,
  type Wareneingang,
} from '@repo/contracts';
import {
  fetchGoodsReceipt,
  fetchGoodsReceiptBooking,
  fetchGoodsReceiptOrder,
} from '../lib/api';

export type ReceiptResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GoodsReceipt }
  | { status: 'error'; message: string };

export type OrderState =
  | { status: 'loading' }
  | { status: 'success'; order: GoodsReceiptOrder }
  | { status: 'error'; message: string };

export type BookingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GoodsReceiptBooking }
  | { status: 'error'; message: string };

const EXPIRY_PATTERN = /^(0[1-9]|1[0-2])\d{4}$/;

export function isValidExpiry(value: string): boolean {
  return EXPIRY_PATTERN.test(value);
}

// All state behind the goods receipt flow: the result from Claude for the
// spoken words, the purchase order, and the booking in the ERP.
export function useGoodsReceipt({
  onCreated,
}: {
  // Called once a receipt was created from spoken words.
  onCreated?: (data: GoodsReceipt) => void;
} = {}) {
  const [result, setResult] = useState<ReceiptResult>({ status: 'idle' });
  const [order, setOrder] = useState<OrderState>({ status: 'loading' });
  const [booking, setBooking] = useState<BookingState>({ status: 'idle' });
  const request = useRef<AbortController | null>(null);
  const bookingRequest = useRef<AbortController | null>(null);
  const orderRequest = useRef<AbortController | null>(null);
  const created = useRef(onCreated);
  useEffect(() => {
    created.current = onCreated;
  });

  // Reads the open positions from the ERP, replacing any read in progress.
  function loadOrder() {
    orderRequest.current?.abort();
    const controller = new AbortController();
    orderRequest.current = controller;
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
  }

  useEffect(() => {
    loadOrder();
    return () => {
      orderRequest.current?.abort();
      request.current?.abort();
      bookingRequest.current?.abort();
    };
  }, []);

  // Creates the receipt from the spoken words. A new recording replaces the
  // previous result.
  async function create(text: string) {
    request.current?.abort();
    const parsed = goodsReceiptRequestSchema.safeParse({ text });
    if (!parsed.success) {
      setResult({
        status: 'error',
        message: parsed.error.issues[0]?.message ?? 'Nothing was said.',
      });
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setResult({ status: 'loading' });
    setBooking({ status: 'idle' });
    try {
      const data = await fetchGoodsReceipt(
        parsed.data.text,
        order.status === 'success' ? order.order : null,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResult({ status: 'success', data });
      created.current?.(data);
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

  // Forgets everything and reads the open positions again.
  function reset() {
    request.current?.abort();
    request.current = null;
    bookingRequest.current?.abort();
    bookingRequest.current = null;
    setResult({ status: 'idle' });
    setBooking({ status: 'idle' });
    setOrder({ status: 'loading' });
    loadOrder();
  }

  // Sets the expiry date (MMYYYY) of one recognised article and of the
  // matching VCS line in the booking JSON.
  function setExpiry(itemIndex: number, value: string) {
    setResult((current) => {
      if (current.status !== 'success') return current;
      const item = current.data.items[itemIndex];
      if (!item) return current;
      const previous = item.Verfalldatum;
      const items = current.data.items.map((entry, index) =>
        index === itemIndex
          ? { ...entry, Verfalldatum: value, expiryDefaulted: false }
          : entry,
      );
      const bestellungen = current.data.bestellungen.map((receipt) => ({
        ...receipt,
        positionen: receipt.positionen.map((position) =>
          position.Positionnummer === item.Positionnummer
            ? {
                ...position,
                VCS: position.VCS.map((entry) =>
                  entry.Charge === (item.Charge ?? '') &&
                  entry.Verfalldatum === previous
                    ? { ...entry, Verfalldatum: value }
                    : entry,
                ),
              }
            : position,
        ),
      }));
      return {
        status: 'success',
        data: { ...current.data, items, bestellungen },
      };
    });
    setBooking({ status: 'idle' });
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

  // After a partial failure, only the rejected positions are sent again.
  function bookingsToConfirm(): Wareneingang[] {
    if (result.status !== 'success') return [];
    const bestellungen = result.data.bestellungen;
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

  return {
    result,
    order,
    booking,
    loading: result.status === 'loading',
    create,
    cancel,
    reset,
    setExpiry,
    confirm,
    bookingsToConfirm,
    articleName,
  };
}

export type GoodsReceiptController = ReturnType<typeof useGoodsReceipt>;
