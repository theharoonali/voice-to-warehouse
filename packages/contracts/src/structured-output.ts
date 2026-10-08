import { z } from 'zod';

export const structuredOutputRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Enter some text to convert.')
    .max(8_000, 'Keep the input under 8,000 characters.'),
});

// Demo contract: replace these fields with the eventual warehouse data model.
export const structuredOutputSchema = z.object({
  summary: z.string().describe('A short summary in the input language.'),
  language: z.enum(['en', 'de', 'other']),
  itemCount: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The number of entries in the items array, not the sum of quantities.',
    ),
  isUrgent: z
    .boolean()
    .describe('True only when urgency is explicitly stated.'),
  tags: z
    .array(z.string())
    .describe('Short descriptive tags based on the text.'),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z
        .number()
        .nonnegative()
        .nullable()
        .describe('The stated quantity, or null if unknown.'),
    }),
  ),
  location: z.object({
    source: z.string().nullable(),
    destination: z.string().nullable(),
  }),
  notes: z
    .string()
    .nullable()
    .describe('Other relevant details, or null if none were given.'),
});

export const structuredOutputResponseSchema = z.object({
  success: z.literal(true),
  data: structuredOutputSchema,
});

export type StructuredOutputRequest = z.infer<
  typeof structuredOutputRequestSchema
>;
export type StructuredOutput = z.infer<typeof structuredOutputSchema>;
export type StructuredOutputResponse = z.infer<
  typeof structuredOutputResponseSchema
>;
