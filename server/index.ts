import { createApp } from './app'
import { loadConfig } from './config'
import { openDatabase } from './db/database'
import { initializeDatabase } from './db/initialize'

const config = loadConfig()
const db = openDatabase(config.dbPath)
const init = initializeDatabase(db, { seed: config.seed, timeZone: config.timeZone })
const app = createApp({ db, config })

const server = app.listen(config.port, config.host, () => {
  console.log(`[mira] API listening on http://${config.host}:${config.port}${config.staticDir ? ' (serving the built app)' : ''}`)
  console.log(`[mira] Database: ${config.dbPath}${init.firstRun ? (init.seeded ? ' — created with demo tasks' : ' — created') : ''}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? `[mira] Port ${config.port} is already in use. Is MIRA already running? Set MIRA_API_PORT to use another port.` : `[mira] Server error: ${err.message}`)
  db.close()
  process.exit(1)
})

let closing = false
function shutdown(signal: string) {
  if (closing) return
  closing = true
  console.log(`[mira] ${signal} received, shutting down`)
  const force = setTimeout(() => process.exit(1), 5000)
  force.unref()
  server.close(() => {
    db.close()
    process.exit(0)
  })
  server.closeIdleConnections()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
