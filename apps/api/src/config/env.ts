import 'dotenv/config';
import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-sonnet-5-5'),
  ELEVENLABS_API_KEY: optionalString,
  // Byte ERP web services used for goods receipts (Wareneingang).
  ERP_BASE_URL: z
    .string()
    .trim()
    .transform((value) => value.replace(/\/+$/, '') || undefined)
    .optional(),
  ERP_USERNAME: optionalString,
  ERP_PASSWORD: optionalString,
  ERP_FIRMA: z.string().trim().min(1).default('01'),
  ERP_BESTELLNUMMER: z.coerce.number().int().positive().default(1712),
  // The ERP host uses a self-signed certificate. Only enable for that host.
  ERP_ALLOW_SELF_SIGNED: z.stringbool().default(false),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error(
    'Invalid API environment:',
    z.flattenError(result.error).fieldErrors,
  );
  process.exit(1);
}

export const env = result.data;
