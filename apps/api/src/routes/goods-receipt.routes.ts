import express, { Router } from 'express';
import {
  goodsReceiptBookRequestSchema,
  goodsReceiptRequestSchema,
} from '@repo/contracts';
import { bookGoodsReceipts } from '../services/goods-receipt-booking.service.js';
import { HttpError } from '../errors/http-error.js';
import {
  createGoodsReceipt,
  getGoodsReceiptOrder,
} from '../services/goods-receipt.service.js';

export const goodsReceiptRouter = Router();

// The configured ERP purchase order, so the app can show what may be booked.
goodsReceiptRouter.get('/order', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', cancel);
  try {
    const data = await getGoodsReceiptOrder(controller.signal);
    if (!controller.signal.aborted) res.json({ success: true, data });
  } finally {
    res.off('close', cancel);
  }
});

// Text (usually a voice transcript) in, ERP goods receipt JSON out.
goodsReceiptRouter.post(
  '/',
  express.json({ limit: '256kb' }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json')) {
      throw new HttpError(
        415,
        'VALIDATION_ERROR',
        'Send an application/json body containing a text field.',
      );
    }
    const { text, order, artikelnummerhersteller } =
      goodsReceiptRequestSchema.parse(req.body as unknown);
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', cancel);
    try {
      const data = await createGoodsReceipt(
        text,
        { order, artikelnummerhersteller },
        controller.signal,
      );
      if (!controller.signal.aborted) res.json({ success: true, data });
    } finally {
      res.off('close', cancel);
    }
  },
);

// Books each receipt in the ERP (one PUT per position) and verifies the booked
// quantities by reading the order again.
goodsReceiptRouter.post(
  '/book',
  express.json({ limit: '256kb' }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json')) {
      throw new HttpError(
        415,
        'VALIDATION_ERROR',
        'Send an application/json body containing a bestellungen array.',
      );
    }
    const { bestellungen } = goodsReceiptBookRequestSchema.parse(
      req.body as unknown,
    );
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', cancel);
    try {
      const data = await bookGoodsReceipts(bestellungen, controller.signal);
      if (!controller.signal.aborted) res.json({ success: true, data });
    } finally {
      res.off('close', cancel);
    }
  },
);
