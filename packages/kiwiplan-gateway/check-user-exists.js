import sql from 'mssql'
import 'dotenv/config'

const config = {
  server: process.env.DB_SERVER,
  database: 'master', // Check server-level principals
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
}

async function checkUserExists() {
  try {
    console.log(`Connecting to ${config.server}...`)
    const pool = await sql.connect(config)

    const result = await pool.request().query(`
      SELECT name FROM sys.server_principals WHERE name = 'leango_gateway_ro'
    `)

    if (result.recordset.length === 0) {
      console.log('\n✓ User "leango_gateway_ro" does NOT exist - safe to create\n')
    } else {
      console.log('\n⚠ User "leango_gateway_ro" already exists:\n')
      console.log(result.recordset)
    }

    await pool.close()
  } catch (err) {
    console.error('Connection failed:', err.message)
    process.exit(1)
  }
}

checkUserExists()
