import sql from 'mssql'
import 'dotenv/config'

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
}

async function verifyPermissions() {
  let pool
  try {
    console.log(`Connecting as ${config.user}...\n`)
    pool = await sql.connect(config)

    // Test 1: SELECT on key tables
    console.log('TEST 1: SELECT on key tables')
    const tables = [
      'ebxQuote', 'ebxProductDesign', 'orgCompany',
      'cstCostRule', 'cstCostAccount', 'cstCostEstimate',
      'ebxRoute', 'ebxStyle', 'ebxStandardBoard',
      'cstPlantRate', 'cstStandardCostRate',
      'ebxStandardColourCoating',
    ]
    for (const table of tables) {
      try {
        const result = await pool.request().query(`SELECT TOP 1 * FROM ${table}`)
        console.log(`  ✓ ${table} - OK (${result.recordset.length} row)`)
      } catch (err) {
        console.log(`  ✗ ${table} - FAILED: ${err.message}`)
      }
    }

    // Test 2: Schema exploration
    console.log('\nTEST 2: Schema exploration')
    try {
      const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM sys.tables`)
      console.log(`  ✓ sys.tables - OK (${result.recordset[0].cnt} tables visible)`)
    } catch (err) {
      console.log(`  ✗ sys.tables - FAILED: ${err.message}`)
    }

    try {
      const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS`)
      console.log(`  ✓ INFORMATION_SCHEMA.COLUMNS - OK (${result.recordset[0].cnt} columns visible)`)
    } catch (err) {
      console.log(`  ✗ INFORMATION_SCHEMA.COLUMNS - FAILED: ${err.message}`)
    }

    // Test 3: Write protection
    console.log('\nTEST 3: Write protection (using HAS_PERMS_BY_NAME, no actual writes)')
    for (const table of tables.slice(0, 6)) {
      const result = await pool.request().query(`
        SELECT
          '${table}' as tableName,
          HAS_PERMS_BY_NAME('${table}', 'OBJECT', 'SELECT') as canSelect,
          HAS_PERMS_BY_NAME('${table}', 'OBJECT', 'INSERT') as canInsert,
          HAS_PERMS_BY_NAME('${table}', 'OBJECT', 'UPDATE') as canUpdate,
          HAS_PERMS_BY_NAME('${table}', 'OBJECT', 'DELETE') as canDelete
      `)
      const row = result.recordset[0]
      const selectOk = row.canSelect === 1
      const writeDenied = row.canInsert === 0 && row.canUpdate === 0 && row.canDelete === 0

      if (selectOk && writeDenied) {
        console.log(`  ✓ ${table} - SELECT=1, INSERT=0, UPDATE=0, DELETE=0`)
      } else {
        console.log(`  ✗ ${table} - SELECT=${row.canSelect}, INSERT=${row.canInsert}, UPDATE=${row.canUpdate}, DELETE=${row.canDelete}`)
      }
    }

    console.log('\n' + '='.repeat(50))
    console.log(' PERMISSION VERIFICATION COMPLETE')
    console.log('='.repeat(50) + '\n')

  } catch (err) {
    console.error('Connection failed:', err.message)
    process.exit(1)
  } finally {
    if (pool) await pool.close()
  }
}

verifyPermissions()
