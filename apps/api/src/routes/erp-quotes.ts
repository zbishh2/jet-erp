import { Hono } from 'hono'
import { eq, and, desc, like, isNull, sql } from 'drizzle-orm'
import type { Env } from '../types/bindings'
import type { AuthContext } from '../types/auth'
import { createDb } from '../db'
import { erpQuote, erpQuoteLine } from '../db/schema'
import { createErpQuoteSchema, updateErpQuoteSchema } from '@jet-erp/shared'
import { requireModuleRole } from '../middleware/require-role'

const erpWrite = requireModuleRole('ADMIN', 'ESTIMATOR')
const erpAdmin = requireModuleRole('ADMIN')

export const erpQuoteRoutes = new Hono<{ Bindings: Env }>()

// Estimating routes require ADMIN or ESTIMATOR role
erpQuoteRoutes.use('*', requireModuleRole('ADMIN', 'ESTIMATOR'))

// Helper: generate quote number QTE-YYYY-NNNN
async function generateQuoteNumber(db: ReturnType<typeof createDb>, organizationId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `QTE-${year}-`

  // Find the highest existing quote number for this year
  const latest = await db
    .select({ quoteNumber: erpQuote.quoteNumber })
    .from(erpQuote)
    .where(
      and(
        eq(erpQuote.organizationId, organizationId),
        like(erpQuote.quoteNumber, `${prefix}%`)
      )
    )
    .orderBy(desc(erpQuote.quoteNumber))
    .limit(1)

  let nextNum = 1
  if (latest.length > 0) {
    const lastNum = parseInt(latest[0].quoteNumber.replace(prefix, ''), 10)
    if (!isNaN(lastNum)) nextNum = lastNum + 1
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`
}

// GET /erp/quotes - List quotes
erpQuoteRoutes.get('/', async (c) => {
  const db = createDb(c.env.DB)
  const auth = c.get('auth') as AuthContext
  const organizationId = auth.organizationId

  const page = parseInt(c.req.query('page') || '1', 10)
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '20', 10), 100)
  const status = c.req.query('status')
  const search = c.req.query('search')

  const conditions = [
    eq(erpQuote.organizationId, organizationId),
    isNull(erpQuote.deletedAt),
  ]

  if (status) {
    conditions.push(eq(erpQuote.status, status))
  }

  if (search) {
    conditions.push(
      sql`(${erpQuote.quoteNumber} LIKE ${`%${search}%`} OR ${erpQuote.customerName} LIKE ${`%${search}%`})`
    )
  }

  const [quotes, countResult] = await Promise.all([
    db
      .select()
      .from(erpQuote)
      .where(and(...conditions))
      .orderBy(desc(erpQuote.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(erpQuote)
      .where(and(...conditions)),
  ])

  return c.json({
    data: quotes,
    page,
    pageSize,
    total: countResult[0]?.count ?? 0,
  })
})

// GET /erp/quotes/:id - Get quote with lines
erpQuoteRoutes.get('/:id', async (c) => {
  const db = createDb(c.env.DB)
  const auth = c.get('auth') as AuthContext
  const organizationId = auth.organizationId
  const id = c.req.param('id')

  const [quote] = await db
    .select()
    .from(erpQuote)
    .where(
      and(
        eq(erpQuote.id, id),
        eq(erpQuote.organizationId, organizationId),
        isNull(erpQuote.deletedAt)
      )
    )
    .limit(1)

  if (!quote) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  const lines = await db
    .select()
    .from(erpQuoteLine)
    .where(eq(erpQuoteLine.quoteId, id))
    .orderBy(erpQuoteLine.lineNumber)

  return c.json({ data: { ...quote, lines } })
})

// POST /erp/quotes - Create quote
erpQuoteRoutes.post('/', erpWrite, async (c) => {
  const db = createDb(c.env.DB)
  const auth = c.get('auth') as AuthContext
  const organizationId = auth.organizationId
  const userId = auth.userId

  const body = await c.req.json()
  const parsed = createErpQuoteSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { lines, ...quoteData } = parsed.data
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  // Generate quote number with retry for collisions
  let quoteNumber: string
  let retries = 3
  while (retries > 0) {
    quoteNumber = await generateQuoteNumber(db, organizationId)
    try {
      await db.insert(erpQuote).values({
        id,
        organizationId,
        quoteNumber: quoteNumber!,
        customerId: quoteData.customerId,
        customerName: quoteData.customerName,
        shipToAddressId: quoteData.shipToAddressId ?? null,
        shippingMethod: quoteData.shippingMethod,
        notes: quoteData.notes ?? null,
        version: 1,
        createdAt: now,
        createdByUserId: userId,
        updatedAt: now,
        updatedByUserId: userId,
      })
      break
    } catch (err: any) {
      if (err.message?.includes('UNIQUE') && retries > 1) {
        retries--
        continue
      }
      throw err
    }
  }

  // Insert lines if provided
  if (lines && lines.length > 0) {
    await db.insert(erpQuoteLine).values(
      lines.map((line) => ({
        id: crypto.randomUUID(),
        quoteId: id,
        lineNumber: line.lineNumber,
        description: line.description ?? null,
        quantity: line.quantity,
        boxStyle: line.boxStyle ?? null,
        length: line.length ?? null,
        width: line.width ?? null,
        depth: line.depth ?? null,
        boardGradeId: line.boardGradeId ?? null,
        boardGradeCode: line.boardGradeCode ?? null,
        inkCoveragePercent: line.inkCoveragePercent,
        isGlued: line.isGlued ? 1 : 0,
        costSnapshot: line.costSnapshot ?? null,
        pricePerM: line.pricePerM ?? null,
        qtyPerHour: line.qtyPerHour ?? null,
        createdAt: now,
        updatedAt: now,
      }))
    )
  }

  // Return the created quote
  const [created] = await db.select().from(erpQuote).where(eq(erpQuote.id, id)).limit(1)
  const createdLines = await db.select().from(erpQuoteLine).where(eq(erpQuoteLine.quoteId, id)).orderBy(erpQuoteLine.lineNumber)

  return c.json({ data: { ...created, lines: createdLines } }, 201)
})

// PATCH /erp/quotes/:id - Update quote
erpQuoteRoutes.patch('/:id', erpWrite, async (c) => {
  const db = createDb(c.env.DB)
  const auth = c.get('auth') as AuthContext
  const organizationId = auth.organizationId
  const userId = auth.userId
  const id = c.req.param('id')

  const body = await c.req.json()
  const parsed = updateErpQuoteSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { lines, version, ...updateData } = parsed.data

  // Optimistic concurrency check
  const [existing] = await db
    .select()
    .from(erpQuote)
    .where(
      and(
        eq(erpQuote.id, id),
        eq(erpQuote.organizationId, organizationId),
        isNull(erpQuote.deletedAt)
      )
    )
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  if (existing.version !== version) {
    return c.json({ error: 'Version conflict — quote was modified by another user' }, 409)
  }

  const now = new Date().toISOString()

  // Build update payload
  const updates: Record<string, unknown> = {
    updatedAt: now,
    updatedByUserId: userId,
    version: version + 1,
  }
  if (updateData.customerId !== undefined) updates.customerId = updateData.customerId
  if (updateData.customerName !== undefined) updates.customerName = updateData.customerName
  if (updateData.shipToAddressId !== undefined) updates.shipToAddressId = updateData.shipToAddressId
  if (updateData.shippingMethod !== undefined) updates.shippingMethod = updateData.shippingMethod
  if (updateData.status !== undefined) updates.status = updateData.status
  if (updateData.notes !== undefined) updates.notes = updateData.notes

  await db.update(erpQuote).set(updates).where(eq(erpQuote.id, id))

  // Replace lines if provided
  if (lines !== undefined) {
    // Delete existing lines
    await db.delete(erpQuoteLine).where(eq(erpQuoteLine.quoteId, id))

    // Insert new lines
    if (lines.length > 0) {
      await db.insert(erpQuoteLine).values(
        lines.map((line) => ({
          id: crypto.randomUUID(),
          quoteId: id,
          lineNumber: line.lineNumber,
          description: line.description ?? null,
          quantity: line.quantity,
          boxStyle: line.boxStyle ?? null,
          length: line.length ?? null,
          width: line.width ?? null,
          depth: line.depth ?? null,
          boardGradeId: line.boardGradeId ?? null,
          boardGradeCode: line.boardGradeCode ?? null,
          inkCoveragePercent: line.inkCoveragePercent,
          isGlued: line.isGlued ? 1 : 0,
          costSnapshot: line.costSnapshot ?? null,
          pricePerM: line.pricePerM ?? null,
          qtyPerHour: line.qtyPerHour ?? null,
          createdAt: now,
          updatedAt: now,
        }))
      )
    }
  }

  const [updated] = await db.select().from(erpQuote).where(eq(erpQuote.id, id)).limit(1)
  const updatedLines = await db.select().from(erpQuoteLine).where(eq(erpQuoteLine.quoteId, id)).orderBy(erpQuoteLine.lineNumber)

  return c.json({ data: { ...updated, lines: updatedLines } })
})

// DELETE /erp/quotes/:id - Soft delete (draft only)
erpQuoteRoutes.delete('/:id', erpAdmin, async (c) => {
  const db = createDb(c.env.DB)
  const auth = c.get('auth') as AuthContext
  const organizationId = auth.organizationId
  const userId = auth.userId
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(erpQuote)
    .where(
      and(
        eq(erpQuote.id, id),
        eq(erpQuote.organizationId, organizationId),
        isNull(erpQuote.deletedAt)
      )
    )
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  if (existing.status !== 'draft') {
    return c.json({ error: 'Only draft quotes can be deleted' }, 400)
  }

  const now = new Date().toISOString()
  await db.update(erpQuote).set({
    deletedAt: now,
    deletedByUserId: userId,
    updatedAt: now,
    updatedByUserId: userId,
  }).where(eq(erpQuote.id, id))

  return c.json({ success: true })
})
