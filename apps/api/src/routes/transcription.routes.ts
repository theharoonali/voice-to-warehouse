import { Router } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../errors/http-error.js';

export const transcriptionRouter = Router();

transcriptionRouter.post('/token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Require a same-origin browser request with a custom header. Cross-origin
  // callers must pass a CORS preflight, which this API does not enable.
  if (
    req.get('X-Transcription-Client') !== 'web' ||
    req.get('Sec-Fetch-Site') === 'cross-site'
  ) {
    throw new HttpError(
      403,
      'VALIDATION_ERROR',
      'Transcription requests must come from this app.',
    );
  }
  if (!env.ELEVENLABS_API_KEY) {
    throw new HttpError(
      503,
      'INTERNAL_ERROR',
      'Live transcription is not configured. Set ELEVENLABS_API_KEY on the API server.',
    );
  }

  try {
    const response = await fetch(
      'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
      {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error('Token request failed');
    }
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('token' in body) ||
      typeof body.token !== 'string' ||
      !body.token
    ) {
      throw new Error('Invalid token response');
    }
    res.json({ token: body.token });
  } catch {
    // Do not forward provider responses or credentials to the browser/logs.
    throw new HttpError(
      502,
      'INTERNAL_ERROR',
      'Could not connect to ElevenLabs. Check the server API key and account access, then try again.',
    );
  }
});
