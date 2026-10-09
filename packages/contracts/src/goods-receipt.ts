import { z } from 'zod';

// Summary of the ERP purchase order (EXP020) shown in the app and reused for
// every goods receipt request, so the ERP is read once per page load.
export const goodsReceiptOrderPositionSchema = z.object({
  Positionnummer: z.number().int(),
  Artikelnummer: z.string(),
  Artikelnummerhersteller: z.string(),
  Artikelbezeichnung: z.string(),
  Bestellstatus: z.string(),
  Einkaufpreis: z.number(),
  Bestellmenge: z.number(),
  Bereitszugebuchtemenge: z.number(),
  Restmenge: z
    .number()
    .describe(
      'Remaining quantity to book: Bestellmenge minus Bereitszugebuchtemenge, never below 0.',
    ),
});

export const goodsReceiptOrderSchema = z.object({
  Firma: z.string(),
  Bestellnummer: z.number().int(),
  Bestellstatus: z.string(),
  Lieferantennummer: z.string(),
  positionen: z.array(goodsReceiptOrderPositionSchema).max(500),
});

export const goodsReceiptOrderResponseSchema = z.object({
  success: z.literal(true),
  data: goodsReceiptOrderSchema,
});

export const goodsReceiptRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Enter some text to convert.')
    .max(8_000, 'Keep the input under 8,000 characters.'),
  // The order as returned by GET /goods-receipt/order. When present, the API
  // builds the prompt and the JSON from it instead of calling the ERP again.
  order: goodsReceiptOrderSchema.optional(),
  // Optional filter: only order positions with one of these manufacturer
  // article numbers (Artikelnummerhersteller) are considered.
  artikelnummerhersteller: z
    .array(
      z
        .union([z.string(), z.number()])
        .transform((value) => String(value).trim())
        .pipe(z.string().min(1, 'Artikelnummerhersteller must not be empty.')),
    )
    .max(200, 'Use 200 article numbers or fewer.')
    .optional(),
});

// The exact goods receipt (Wareneingang) format consumed by the ERP.
export const vcsEntrySchema = z.object({
  Verfalldatum: z.string().describe('Expiry date as MMYYYY, or "" if unknown.'),
  Charge: z.string().describe('Batch number.'),
  Seriennummer: z.string().describe('Serial number, random six digits.'),
  Menge: z.number(),
});

export const wareneingangPositionSchema = z.object({
  Positionnummer: z.number().int(),
  Artikelnummer: z.string(),
  Lagerort: z.string(),
  Einkaufpreis: z.number(),
  Zubuchmenge: z.number(),
  VCS: z.array(vcsEntrySchema),
});

export const wareneingangSchema = z.object({
  Firma: z.string(),
  Bestellnummer: z.number().int(),
  Lieferanten_Rechnungsnummer: z.string(),
  Lieferanten_Rechnungsdatum: z.string(),
  Wareneingangsdatum: z.string(),
  positionen: z.array(wareneingangPositionSchema),
});

// Details the warehouse worker must say for every article.
export const goodsReceiptRequiredFieldSchema = z.enum([
  'Artikelnummer',
  'Zubuchmenge',
  'Lagerort',
  'Charge',
]);

// One recognised article (or batch of an article) for the review table.
export const goodsReceiptItemSchema = z.object({
  spoken: z.string().describe('How the article was referred to.'),
  Positionnummer: z.number().int().nullable(),
  Artikelnummer: z.string().nullable(),
  Artikelbezeichnung: z.string().nullable(),
  Zubuchmenge: z.number().nullable(),
  Lagerort: z.string().nullable(),
  Charge: z.string().nullable(),
  Verfalldatum: z
    .string()
    .describe('MMYYYY as said by the user, or the default when not said.'),
  expiryDefaulted: z
    .boolean()
    .describe('True when the user did not say an expiry date.'),
  missing: z.array(goodsReceiptRequiredFieldSchema),
});

export const goodsReceiptSchema = z.object({
  complete: z.boolean(),
  items: z.array(goodsReceiptItemSchema),
  messages: z
    .array(z.string())
    .describe('One sentence per article with missing details.'),
  // One booking per position, because the ERP accepts a single position per
  // call. Empty until every article is complete.
  bestellungen: z.array(wareneingangSchema),
});

export const goodsReceiptResponseSchema = z.object({
  success: z.literal(true),
  data: goodsReceiptSchema,
});

export type GoodsReceiptOrderPosition = z.infer<
  typeof goodsReceiptOrderPositionSchema
>;
export type GoodsReceiptOrder = z.infer<typeof goodsReceiptOrderSchema>;
export type GoodsReceiptOrderResponse = z.infer<
  typeof goodsReceiptOrderResponseSchema
>;
export type GoodsReceiptRequest = z.infer<typeof goodsReceiptRequestSchema>;
export type VcsEntry = z.infer<typeof vcsEntrySchema>;
export type WareneingangPosition = z.infer<typeof wareneingangPositionSchema>;
export type Wareneingang = z.infer<typeof wareneingangSchema>;
export type GoodsReceiptRequiredField = z.infer<
  typeof goodsReceiptRequiredFieldSchema
>;
export type GoodsReceiptItem = z.infer<typeof goodsReceiptItemSchema>;
export type GoodsReceipt = z.infer<typeof goodsReceiptSchema>;
export type GoodsReceiptResponse = z.infer<typeof goodsReceiptResponseSchema>;

// Booking the receipts in the ERP (IMP015, one position per call).
export const erpReturnSchema = z.object({
  returncode: z.string(),
  message: z.string(),
});

export const goodsReceiptBookRequestSchema = z.object({
  bestellungen: z
    .array(wareneingangSchema)
    .min(1, 'There is nothing to book.')
    .max(50, 'Book 50 positions or fewer at once.'),
});

export const goodsReceiptBookingResultSchema = z.object({
  Positionnummer: z.number().int(),
  Artikelnummer: z.string(),
  Zubuchmenge: z.number(),
  Lieferanten_Rechnungsnummer: z.string(),
  booked: z
    .boolean()
    .describe(
      'True when the ERP accepted the receipt and the booked quantity of the position increased.',
    ),
  bookedBefore: z.number(),
  bookedAfter: z.number(),
  return: z.array(erpReturnSchema).describe('The ERP return codes.'),
});

export const goodsReceiptBookingSchema = z.object({
  allBooked: z.boolean(),
  results: z.array(goodsReceiptBookingResultSchema),
  // The order as read from the ERP after booking.
  order: goodsReceiptOrderSchema,
});

export const goodsReceiptBookResponseSchema = z.object({
  success: z.literal(true),
  data: goodsReceiptBookingSchema,
});

export type ErpReturn = z.infer<typeof erpReturnSchema>;
export type GoodsReceiptBookRequest = z.infer<
  typeof goodsReceiptBookRequestSchema
>;
export type GoodsReceiptBookingResult = z.infer<
  typeof goodsReceiptBookingResultSchema
>;
export type GoodsReceiptBooking = z.infer<typeof goodsReceiptBookingSchema>;
export type GoodsReceiptBookResponse = z.infer<
  typeof goodsReceiptBookResponseSchema
>;
