import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config.js'
import { getPool, closePool } from './db.js'
import { auditMiddleware, getRecentLogs } from './middleware/audit.js'
import { authMiddleware } from './middleware/auth.js'
import quotesRouter from './routes/quotes.js'
import customersRouter from './routes/customers.js'
import costingRouter from './routes/costing.js'
import boardsRouter from './routes/boards.js'
import inksRouter from './routes/inks.js'
import stylesRouter from './routes/styles.js'
import ratesRouter from './routes/rates.js'
import schemaRouter from './routes/schema.js'
import addressesRouter from './routes/addresses.js'
import routingRouter from './routes/routing.js'
import costAnalysisRouter from './routes/cost-analysis.js'
import salesRouter from './routes/sales.js'
import queryRouter from './routes/query.js'

const app = express()

// Security middleware
app.use(helmet())
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}))
app.use(express.json())

// Authentication middleware (checks SERVICE_TOKEN if configured)
app.use(authMiddleware)

// Audit logging middleware
app.use(auditMiddleware)

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    devMode: config.devMode,
    testCompanyId: config.devMode ? config.testCompanyId : undefined,
    timestamp: new Date().toISOString(),
  })
})

// Audit logs endpoint (for debugging)
app.get('/audit-logs', (req, res) => {
  if (!config.devMode) {
    res.status(403).json({ error: 'Only available in dev mode' })
    return
  }
  res.json({
    logs: getRecentLogs(50),
  })
})

// Mount routes
app.use('/quotes', quotesRouter)
app.use('/customers', customersRouter)
app.use('/costing', costingRouter)
app.use('/boards', boardsRouter)
app.use('/inks', inksRouter)
app.use('/styles', stylesRouter)
app.use('/rates', ratesRouter)
app.use('/schema', schemaRouter)
app.use('/addresses', addressesRouter)
app.use('/routing', routingRouter)
app.use('/cost-analysis', costAnalysisRouter)
app.use('/sales', salesRouter)
app.use('/query', queryRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[ERROR]', err)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server
async function start() {
  try {
    // Test database connection
    console.log('[STARTUP] Testing database connection...')
    await getPool()

    // Start HTTP server
    app.listen(config.port, config.host, () => {
      console.log('')
      console.log('='.repeat(60))
      console.log(' Kiwiplan Gateway Service')
      console.log('='.repeat(60))
      console.log(`  URL:           http://${config.host}:${config.port}`)
      console.log(`  Dev Mode:      ${config.devMode}`)
      if (config.devMode) {
        console.log(`  Test Company:  ${config.testCompanyId}`)
      }
      console.log(`  Auth:          ${config.serviceToken ? 'ENABLED (SERVICE_TOKEN)' : 'DISABLED (private network)'}`)
      console.log(`  Database:      ${config.db.server}/${config.db.database}`)
      console.log(`  Log Queries:   ${config.logQueries}`)
      console.log('='.repeat(60))
      console.log('')
      console.log('Endpoints:')
      console.log('  GET  /health           - Health check')
      console.log('  GET  /audit-logs       - Recent audit logs (dev only)')
      console.log('  GET  /quotes           - List quotes')
      console.log('  GET  /quotes/:id       - Get quote detail')
      console.log('  GET  /customers        - List customers')
      console.log('  GET  /customers/:id    - Get customer detail')
      console.log('  GET  /costing/rules    - List cost rules')
      console.log('  GET  /costing/estimate/:id - Get cost estimate')
      console.log('  GET  /boards           - List board grades')
      console.log('  GET  /inks             - List inks/colors')
      console.log('  GET  /styles           - List box styles')
      console.log('  GET  /rates            - List plant rates')
      console.log('  GET  /addresses        - List customer addresses')
      console.log('  GET  /addresses/freight-zone - Get freight zone')
      console.log('  GET  /addresses/despatch-mode/:id - Get despatch mode')
      console.log('  GET  /routing          - Get machine routing')
      console.log('  GET  /cost-analysis/variance  - Cost variance report')
      console.log('  GET  /cost-analysis/stats     - Variance statistics')
      console.log('  GET  /cost-analysis/trend     - Variance monthly trend')
      console.log('  GET  /sales/monthly-summary   - Sales monthly summary')
      console.log('  GET  /sales/by-rep            - Sales by rep')
      console.log('  GET  /sales/by-customer       - Sales by customer')
      console.log('  GET  /sales/reps              - Sales rep list')
      console.log('  POST /query                   - Generic SQL query proxy')
      console.log('')
    })
  } catch (error) {
    console.error('[STARTUP] Failed to start:', error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Closing connections...')
  await closePool()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Closing connections...')
  await closePool()
  process.exit(0)
})

start()
