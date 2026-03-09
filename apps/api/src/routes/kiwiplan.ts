import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { kvCache, CacheTTL } from '../services/kv-cache'

export const kiwiplanRoutes = new Hono<{ Bindings: Env }>()

// Helper to get configured client
function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

// GET /api/erp/health - Check gateway connectivity
kiwiplanRoutes.get('/health', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const health = await client.health()
    return c.json(health)
  } catch (err) {
    return c.json({ error: 'Gateway unreachable' }, 503)
  }
})

// Legacy Kiwiplan quote proxy routes removed — D1 CRUD routes handle /erp/quotes now

// GET /api/erp/customers - List customers
// orgCompany is the customer master table - all Jet employees can see all customers
kiwiplanRoutes.get('/customers', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const page = parseInt(c.req.query('page') || '1', 10)
  const pageSize = parseInt(c.req.query('pageSize') || '20', 10)
  const search = c.req.query('search')

  try {
    const result = await client.listCustomers({ companyId: 1, page, pageSize, search })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/customers/:id - Get customer detail
kiwiplanRoutes.get('/customers/:id', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const customerId = parseInt(c.req.param('id'), 10)

  try {
    const result = await client.getCustomer(customerId, { companyId: 1 })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/costing/rules - List cost rules
// Note: Cost rules are system-wide configuration, not tenant-scoped
kiwiplanRoutes.get('/costing/rules', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const result = await client.getCostRules()
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/costing/estimate/:id - Get cost estimate for product design
kiwiplanRoutes.get('/costing/estimate/:id', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const productDesignId = parseInt(c.req.param('id'), 10)

  try {
    const result = await client.getCostEstimate(productDesignId, { companyId: 1 })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/boards - List board grades sorted by order volume (KV cached 30min)
kiwiplanRoutes.get('/boards', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const result = await kvCache(c.env.AUTH_CACHE, 'boards-by-volume', CacheTTL.LOOKUP_DATA, () =>
      client.rawQuery(
        `SELECT sb.ID as boardId, sb.code, sb.description, sb.density, sb.thickness,
                sb.costperarea as costPerArea, sb.isobsolete as isObsolete,
                sb.basicboardname as basicBoardName,
                ISNULL(vol.cnt, 0) as orderCount
         FROM ebxStandardBoard sb
         LEFT JOIN (
           SELECT pd.standardboardID, COUNT(*) as cnt
           FROM espOrder o
           INNER JOIN ebxProductDesign pd ON o.designnumber = pd.designnumber
           WHERE o.cancelleddate IS NULL
             AND o.entrydate >= DATEADD(month, -12, GETDATE())
           GROUP BY pd.standardboardID
         ) vol ON vol.standardboardID = sb.ID
         WHERE sb.isobsolete = 0
         ORDER BY ISNULL(vol.cnt, 0) DESC, sb.code`,
      )
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/inks - List inks/colors (reference data)
kiwiplanRoutes.get('/inks', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const result = await client.listInks()
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/styles - List box styles sorted by order volume (KV cached 30min)
kiwiplanRoutes.get('/styles', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const result = await kvCache(c.env.AUTH_CACHE, 'styles-by-volume', CacheTTL.LOOKUP_DATA, () =>
      client.rawQuery(
        `SELECT s.ID as styleId, s.stylecode as code, s.description,
                s.stylestatus as status, s.analysisgroup as analysisGroup,
                s.imagename as imageName, s.unitdescription as unitDescription,
                ISNULL(vol.cnt, 0) as orderCount
         FROM ebxStyle s
         LEFT JOIN (
           SELECT pd.styleID, COUNT(*) as cnt
           FROM espOrder o
           INNER JOIN ebxProductDesign pd ON o.designnumber = pd.designnumber
           WHERE o.cancelleddate IS NULL
             AND o.entrydate >= DATEADD(month, -12, GETDATE())
           GROUP BY pd.styleID
         ) vol ON vol.styleID = s.ID
         WHERE s.stylestatus IS NULL OR s.stylestatus <> 'Obsolete'
         ORDER BY ISNULL(vol.cnt, 0) DESC, s.stylecode`,
      )
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/rates - List plant rates (reference data)
kiwiplanRoutes.get('/rates', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const result = await client.listPlantRates()
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/addresses?customerId=123 - List customer addresses
kiwiplanRoutes.get('/addresses', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const customerId = parseInt(c.req.query('customerId') || '', 10)
  if (isNaN(customerId)) {
    return c.json({ error: 'customerId is required' }, 400)
  }

  try {
    const result = await client.listCustomerAddresses(customerId)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/addresses/freight-zone?deliveryRegionId=456 - Get freight zone
kiwiplanRoutes.get('/addresses/freight-zone', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const deliveryRegionId = parseInt(c.req.query('deliveryRegionId') || '', 10)
  if (isNaN(deliveryRegionId)) {
    return c.json({ error: 'deliveryRegionId is required' }, 400)
  }

  try {
    const result = await client.getFreightZone(deliveryRegionId)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/addresses/despatch-mode/:id - Get despatch mode
kiwiplanRoutes.get('/addresses/despatch-mode/:id', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const despatchModeId = parseInt(c.req.param('id'), 10)

  try {
    const result = await client.getDespatchMode(despatchModeId)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/routing/style-ids - Get style IDs that have routing (product designs)
kiwiplanRoutes.get('/routing/style-ids', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const result = await client.rawQuery<{ styleID: number }>(
      `SELECT DISTINCT pd.styleID
       FROM ebxProductDesign pd
       INNER JOIN ebxRoute r ON r.productDesignID = pd.ID
       INNER JOIN ebxMachineStep ms ON ms.routeID = r.ID
       WHERE r.plantID = 1`,
    )
    const styleIds = result.data.map(r => r.styleID)
    return c.json({ data: styleIds })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/routing/by-style?styleId=123 - Get routing from most recent product design for a style
kiwiplanRoutes.get('/routing/by-style', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const styleId = parseInt(c.req.query('styleId') || '', 10)
  if (isNaN(styleId)) {
    return c.json({ error: 'styleId is required' }, 400)
  }

  try {
    // Use rawQuery with correct table names (ebx/esp schema)
    // Find the most recent product design for this style, then get its route steps
    const result = await client.rawQuery<{
      machineno: number
      machinename: string | null
      machinegroup: string | null
      sequencenumber: number
      routingstdrunrate: number | null
      costingstdrunrate: number | null
      routingstdsetupmins: number | null
      costingstdsetupmins: number | null
      inkcount: number | null
      routingstdruncrew: number | null
      costingstdruncrew: number | null
    }>(
      `SELECT ms.machineno,
              (SELECT TOP 1 mrs.machinename FROM espMachineRouteStep mrs WHERE mrs.machineno = ms.machineno) AS machinename,
              (SELECT TOP 1 mrs.machinegroup FROM espMachineRouteStep mrs WHERE mrs.machineno = ms.machineno) AS machinegroup,
              ms.sequencenumber,
              ms.routingstdrunrate, ms.costingstdrunrate,
              ms.routingstdsetupmins, ms.costingstdsetupmins,
              ms.inkcount, ms.routingstdruncrew AS routingcrew, ms.costingstdruncrew AS costingcrew
       FROM ebxProductDesign pd
       INNER JOIN ebxRoute r ON r.productDesignID = pd.ID
       INNER JOIN ebxMachineStep ms ON ms.routeID = r.ID
       WHERE pd.styleID = @styleId
         AND r.plantID = 1
         AND pd.ID = (
           SELECT TOP 1 pd2.ID FROM ebxProductDesign pd2
           INNER JOIN ebxRoute r2 ON r2.productDesignID = pd2.ID
           WHERE pd2.styleID = @styleId AND r2.plantID = 1
           ORDER BY pd2.ID DESC
         )
       ORDER BY ms.sequencenumber`,
      { styleId },
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/routing?productDesignId=789 - Get machine routing
kiwiplanRoutes.get('/routing', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const productDesignId = parseInt(c.req.query('productDesignId') || '', 10)
  if (isNaN(productDesignId)) {
    return c.json({ error: 'productDesignId is required' }, 400)
  }

  try {
    const result = await client.getRouting(productDesignId, { companyId: 1 })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/schema/columns?tableName=espInvoiceLines - Explore table schema
kiwiplanRoutes.get('/schema/columns', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const tableName = c.req.query('tableName')
  if (!tableName) {
    return c.json({ error: 'tableName is required' }, 400)
  }

  try {
    const result = await client.getTableColumns(tableName)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/schema/tables?pattern=invoice - Find tables by pattern
kiwiplanRoutes.get('/schema/tables', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const pattern = c.req.query('pattern')
  if (!pattern) {
    return c.json({ error: 'pattern is required' }, 400)
  }

  try {
    const result = await client.findTables(pattern)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/score-formulas - Score formulas + style-to-group mappings (KV cached 30min)
kiwiplanRoutes.get('/score-formulas', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const data = await kvCache(c.env.AUTH_CACHE, 'score-formulas', CacheTTL.LOOKUP_DATA, async () => {
      const [formulaResult, styleResult] = await Promise.all([
        client.rawQuery<{
          groupId: number
          groupName: string
          formulaId: number
          formulaDescription: string | null
          formula: string
        }>(
          `SELECT sf.scoreFormulaGroupID as groupId, sfg.name as groupName,
                  sf.ID as formulaId, sf.description as formulaDescription,
                  sf.scoreformula as formula
           FROM ebxScoreFormula sf
           INNER JOIN ebxScoreFormulaGroup sfg ON sfg.ID = sf.scoreFormulaGroupID`,
        ),
        client.rawQuery<{
          styleId: number
          code: string
          lwGroupId: number | null
          wwGroupId: number | null
        }>(
          `SELECT s.ID as styleId, s.stylecode as code,
                  s.sumtolengthScoreFormulaGroupID as lwGroupId,
                  s.sumtowidthScoreFormulaGroupID as wwGroupId
           FROM ebxStyle s WHERE s.stylestatus IS NULL OR s.stylestatus <> 'Obsolete'`,
        ),
      ])

      return {
        formulas: formulaResult.data,
        styleGroups: styleResult.data,
      }
    })

    return c.json(data)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/volume-rankings - Invoice line counts per board/style (KV cached 24h)
kiwiplanRoutes.get('/volume-rankings', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const data = await kvCache(c.env.AUTH_CACHE, 'volume-rankings', CacheTTL.DATE_LIMITS, async () => {
      const [boardResult, styleResult] = await Promise.all([
        client.rawQuery<{ code: string; cnt: number }>(
          `SELECT sb.code, COUNT(*) as cnt
           FROM espOrder o
           INNER JOIN ebxProductDesign pd ON o.designnumber = pd.designnumber
           INNER JOIN ebxStandardBoard sb ON pd.standardboardID = sb.ID
           WHERE o.cancelleddate IS NULL
             AND o.entrydate >= DATEADD(month, -12, GETDATE())
           GROUP BY sb.code
           ORDER BY cnt DESC`,
        ),
        client.rawQuery<{ code: string; cnt: number }>(
          `SELECT s.stylecode as code, COUNT(*) as cnt
           FROM espOrder o
           INNER JOIN ebxProductDesign pd ON o.designnumber = pd.designnumber
           INNER JOIN ebxStyle s ON pd.styleID = s.ID
           WHERE o.cancelleddate IS NULL
             AND o.entrydate >= DATEADD(month, -12, GETDATE())
           GROUP BY s.stylecode
           ORDER BY cnt DESC`,
        ),
      ])

      // Convert to code → rank maps for fast lookup
      const boards: Record<string, number> = {}
      boardResult.data.forEach((r, i) => { boards[r.code] = i })
      const styles: Record<string, number> = {}
      styleResult.data.forEach((r, i) => { styles[r.code] = i })

      return { boards, styles }
    })

    return c.json(data)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})
