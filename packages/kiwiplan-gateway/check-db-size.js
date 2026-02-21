import sql from 'mssql'
import 'dotenv/config'

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
}

async function checkDbSize() {
  const pool = await sql.connect(config)
  const result = await pool.request().query('EXEC sp_spaceused')
  console.log('\nDatabase Size:')
  console.table(result.recordsets[0])
  if (result.recordsets[1]) {
    console.log('\nUnallocated Space:')
    console.table(result.recordsets[1])
  }
  await pool.close()
}

checkDbSize().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
