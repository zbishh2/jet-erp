/**
 * Run a .sql file against the Kiwiplan SQL Server.
 *
 * Usage:
 *   node run-sql.js <path-to-sql-file> --admin-user <user> --admin-password <password>
 *
 * Uses DB_SERVER and DB_DATABASE from .env, but requires admin credentials
 * as arguments (since .env has the read-only user).
 */
import sql from 'mssql'
import fs from 'fs'
import 'dotenv/config'

const args = process.argv.slice(2)
const sqlFile = args[0]
const adminUserIdx = args.indexOf('--admin-user')
const adminPassIdx = args.indexOf('--admin-password')

if (!sqlFile || adminUserIdx === -1 || adminPassIdx === -1) {
  console.error('Usage: node run-sql.js <file.sql> --admin-user <user> --admin-password <password>')
  process.exit(1)
}

const adminUser = args[adminUserIdx + 1]
const adminPassword = args[adminPassIdx + 1]

if (!adminUser || !adminPassword) {
  console.error('Both --admin-user and --admin-password are required')
  process.exit(1)
}

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: adminUser,
  password: adminPassword,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
}

async function main() {
  const content = fs.readFileSync(sqlFile, 'utf-8')

  // Split on GO (must be on its own line, case-insensitive)
  const batches = content
    .split(/^\s*GO\s*$/gim)
    .map(b => b.trim())
    .filter(b => b.length > 0)

  console.log(`Connecting to ${config.server} as ${config.user}...`)
  const pool = await sql.connect(config)
  console.log(`Running ${batches.length} batches from ${sqlFile}\n`)

  for (let i = 0; i < batches.length; i++) {
    try {
      const result = await pool.request().query(batches[i])

      // Print any messages (from PRINT statements)
      if (result.recordset && result.recordset.length > 0) {
        console.table(result.recordset)
      }
    } catch (err) {
      console.error(`\nBatch ${i + 1} FAILED:`)
      console.error(err.message)
      console.error('\nBatch content (first 200 chars):')
      console.error(batches[i].substring(0, 200))
      console.error('\nAborting remaining batches.')
      await pool.close()
      process.exit(1)
    }
  }

  console.log('\nAll batches completed successfully.')
  await pool.close()
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
