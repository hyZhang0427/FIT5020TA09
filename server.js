import express from 'express'
import cors from 'cors'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors({
  origin: [
    'http://localhost:5173',
    process.env.FRONTEND_URL,
  ],
}))
app.use(express.json())

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Server is running',
  })
})

app.get('/api/db-health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()')
    res.json({ ok: true, time: result.rows[0].now })
  } catch (err) {
    console.error('DB health error:', err)
    res.status(500).json({ ok: false, error: 'Database connection failed' })
  }
})

app.get('/api/uv-trends', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        year,
        month,
        uv,
        heat,
        uv_peak AS "uvPeak",
        is_peak_uv AS "isPeakUv"
      FROM uv_heat_trends
      ORDER BY year, month
    `)

    res.json(result.rows)
  } catch (err) {
    console.error('uv-trends error:', err)
    res.status(500).json({ error: 'Failed to fetch UV trend data' })
  }
})

app.get('/api/skin-cancer-stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        year,
        age30,
        age60,
        lifetime
      FROM skin_cancer_stats
      ORDER BY year
    `)

    res.json(result.rows)
  } catch (err) {
    console.error('skin-cancer-stats error:', err)
    res.status(500).json({ error: 'Failed to fetch skin cancer stats' })
  }
})

const port = Number(process.env.PORT || 3001)
app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`)
})