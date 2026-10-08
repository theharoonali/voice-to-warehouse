import { greetingQuerySchema, type GreetingResponse } from '@repo/contracts';
import type { RequestHandler } from 'express';
import { createGreeting } from '../services/greeting.service.js';

export const getGreeting: RequestHandler<
  Record<string, never>,
  GreetingResponse
> = (req, res) => {
  const query = greetingQuerySchema.parse(req.query);
  const greeting = createGreeting(query);

  res.status(200).json({ success: true, data: greeting });
};
