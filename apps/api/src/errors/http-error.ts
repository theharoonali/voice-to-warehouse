import type { ApiErrorCode, ApiErrorDetail } from '@repo/contracts';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
