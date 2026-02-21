import sql from 'mssql'
import crypto from 'crypto'
import 'dotenv/config'

// Generate a secure password
const password = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, 'x')

const config = {
  server: process.env.DB_SERVER,
  database: 'master',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
}

async function setupReadOnlyUser() {
  let pool
  try {
    console.log(`Connecting to ${config.server} as ${config.user}...`)
    pool = await sql.connect(config)

    // Step 1: Create login
    console.log('\n[1/5] Creating server login...')
    await pool.request().query(`
      CREATE LOGIN leango_gateway_ro
        WITH PASSWORD = '${password}',
        DEFAULT_DATABASE = esp,
        CHECK_POLICY = ON
    `)
    console.log('  ✓ Login created')

    // Step 2: Create user in esp database
    console.log('[2/5] Creating database user...')
    await pool.request().query(`USE esp`)
    await pool.request().query(`
      CREATE USER leango_gateway_ro FOR LOGIN leango_gateway_ro
    `)
    console.log('  ✓ User created in esp database')

    // Step 3: Grant SELECT permissions
    console.log('[3/5] Granting SELECT permissions...')
    const tables = ['ebxQuote', 'ebxProductDesign', 'orgCompany', 'cstCostRule', 'cstCostAccount', 'cstCostEstimate']
    for (const table of tables) {
      await pool.request().query(`GRANT SELECT ON ${table} TO leango_gateway_ro`)
    }
    console.log(`  ✓ SELECT granted on ${tables.length} tables`)

    // Step 4: DENY write operations
    console.log('[4/5] Denying write operations...')
    for (const table of tables) {
      await pool.request().query(`DENY INSERT, UPDATE, DELETE ON ${table} TO leango_gateway_ro`)
    }
    console.log('  ✓ INSERT/UPDATE/DELETE denied on all tables')

    // Step 5: Deny dangerous permissions
    console.log('[5/5] Denying dangerous permissions...')
    await pool.request().query(`DENY CREATE TABLE TO leango_gateway_ro`)
    await pool.request().query(`DENY ALTER ANY SCHEMA TO leango_gateway_ro`)
    await pool.request().query(`DENY EXECUTE TO leango_gateway_ro`)
    await pool.request().query(`DENY VIEW DEFINITION TO leango_gateway_ro`)
    console.log('  ✓ Dangerous permissions denied')

    console.log('\n' + '='.repeat(60))
    console.log(' READ-ONLY USER CREATED SUCCESSFULLY')
    console.log('='.repeat(60))
    console.log('\nUpdate your .env file with:')
    console.log(`  DB_USER=leango_gateway_ro`)
    console.log(`  DB_PASSWORD=${password}`)
    console.log('\n⚠️  Save this password now - it cannot be retrieved later!')
    console.log('='.repeat(60) + '\n')

  } catch (err) {
    console.error('\n✗ Setup failed:', err.message)
    process.exit(1)
  } finally {
    if (pool) await pool.close()
  }
}

setupReadOnlyUser()
