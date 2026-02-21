import { z } from 'zod';

// Quote statuses
export const ErpQuoteStatus = {
  DRAFT: 'draft',
  SENT: 'sent',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const;

export type ErpQuoteStatusType = typeof ErpQuoteStatus[keyof typeof ErpQuoteStatus];

// Quote line schema
const quoteLineSchema = z.object({
  lineNumber: z.number().int().min(1),
  description: z.string().optional(),
  quantity: z.number().int().min(1).default(5000),
  boxStyle: z.string().optional(),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  depth: z.number().positive().optional(),
  boardGradeId: z.number().int().optional(),
  boardGradeCode: z.string().optional(),
  inkCoveragePercent: z.number().min(0).max(100).default(0),
  isGlued: z.boolean().default(true),
  costSnapshot: z.string().optional(), // JSON string
  pricePerM: z.number().optional(),
});

// Full ERP Quote schema
export const erpQuoteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  quoteNumber: z.string().min(1),
  customerId: z.number().int(),
  customerName: z.string().min(1),
  shipToAddressId: z.number().int().nullable(),
  shippingMethod: z.string().default('freight'),
  status: z.string().default('draft'),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  createdByUserId: z.string().uuid(),
  updatedAt: z.string().datetime(),
  updatedByUserId: z.string().uuid(),
  lines: z.array(quoteLineSchema).optional(),
});

// Create quote schema
export const createErpQuoteSchema = z.object({
  customerId: z.number().int(),
  customerName: z.string().min(1),
  shipToAddressId: z.number().int().optional(),
  shippingMethod: z.string().default('freight'),
  notes: z.string().optional(),
  lines: z.array(quoteLineSchema).optional(),
});

// Update quote schema
export const updateErpQuoteSchema = z.object({
  customerId: z.number().int().optional(),
  customerName: z.string().min(1).optional(),
  shipToAddressId: z.number().int().optional(),
  shippingMethod: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(quoteLineSchema).optional(),
  version: z.number().int().positive(),
});

// Types
export type ErpQuote = z.infer<typeof erpQuoteSchema>;
export type CreateErpQuote = z.infer<typeof createErpQuoteSchema>;
export type UpdateErpQuote = z.infer<typeof updateErpQuoteSchema>;
export type ErpQuoteLine = z.infer<typeof quoteLineSchema>;
