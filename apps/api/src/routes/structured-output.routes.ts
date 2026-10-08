import express, { Router } from 'express';
import { structuredOutputRequestSchema } from '@repo/contracts';
import { generateStructuredOutput } from '../services/structured-output.service.js';
import { HttpError } from '../errors/http-error.js';

export const structuredOutputRouter = Router();

structuredOutputRouter.post(
  '/',
  express.json({ limit: '32kb' }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json')) {
      throw new HttpError(
        415,
        'VALIDATION_ERROR',
        'Send an application/json body containing a text field.',
      );
    }
    const { text } = structuredOutputRequestSchema.parse(req.body as unknown);
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', cancel);
    try {
      const data = await generateStructuredOutput(text, controller.signal);
      if (!controller.signal.aborted) res.json({ success: true, data });
    } finally {
      res.off('close', cancel);
    }
  },
);
