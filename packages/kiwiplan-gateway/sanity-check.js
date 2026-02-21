import sql from 'mssql'
import 'dotenv/config'

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
}

async function sanityCheck() {
  console.log(`Connecting as ${config.user}...\n`)
  const pool = await sql.connect(config)

  const tables = [
    'ebxQuote',
    'ebxProductDesign',
    'orgCompany',
    'cstCostRule',
    'cstCostAccount',
    'cstCostEstimate',
  ]

  console.log('Row counts (read-only check):')
  for (const table of tables) {
    const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM ${table}`)
    console.log(`  ${table}: ${result.recordset[0].cnt} rows`)
  }

  await pool.close()
  console.log('\n✓ Sanity check passed - read access working, no data modified')
}

sanityCheck().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
