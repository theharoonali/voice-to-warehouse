import { z } from 'zod';

export const greetingQuerySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Please enter a name.')
    .max(80, 'Use 80 characters or fewer.')
    .default('World'),
});

export const greetingSchema = z.object({
  message: z.string(),
  generatedAt: z.iso.datetime(),
});

export const greetingResponseSchema = z.object({
  success: z.literal(true),
  data: greetingSchema,
});

export type GreetingQuery = z.infer<typeof greetingQuerySchema>;
export type Greeting = z.infer<typeof greetingSchema>;
export type GreetingResponse = z.infer<typeof greetingResponseSchema>;
