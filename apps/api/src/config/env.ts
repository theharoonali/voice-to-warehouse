import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
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
