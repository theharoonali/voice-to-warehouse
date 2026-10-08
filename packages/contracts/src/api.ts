import { z } from 'zod';

export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(['VALIDATION_ERROR', 'NOT_FOUND', 'INTERNAL_ERROR']),
    message: z.string(),
    details: z
      .array(z.object({ field: z.string(), message: z.string() }))
      .optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = ApiErrorResponse['error']['code'];
export type ApiErrorDetail = NonNullable<
  ApiErrorResponse['error']['details']
>[number];

export type ApiSuccessResponse<T> = { success: true; data: T };
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
