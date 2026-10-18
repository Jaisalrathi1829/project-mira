import path from 'node:path'

export type Config = {
  host: string
  port: number
  dbPath: string
  /** Insert the demonstration tasks when a brand-new database is created. */
  seed: boolean
  allowedOrigins: string[]
  allowedHosts: string[]
  /** Serve the built frontend (dist/) from the API server. */
  staticDir: string | null
  /** IANA zone used for "today" on the server. Defaults to the machine's zone. */
  timeZone: string | undefined
  googleCredentialsConfigured: boolean
  logRequests: boolean
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]']

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): Config {
  const port = Number(env.MIRA_API_PORT ?? 8787)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`MIRA_API_PORT must be a port number, got "${env.MIRA_API_PORT}"`)
  const uiPort = Number(env.PORT ?? 8443)
  const origins = LOOPBACK_NAMES.flatMap((h) => [`http://${h}:${uiPort}`, `https://${h}:${uiPort}`, `http://${h}:${port}`])
  const serveStatic = argv.includes('--static') || env.MIRA_SERVE_STATIC === 'true'
  return {
    host: env.MIRA_API_HOST ?? '127.0.0.1',
    port,
    dbPath: env.MIRA_DB_PATH ?? path.resolve(process.cwd(), 'data', 'mira.sqlite'),
    seed: env.MIRA_SEED !== 'false',
    allowedOrigins: [...origins, ...list(env.MIRA_ALLOWED_ORIGINS)],
    allowedHosts: [...LOOPBACK_NAMES, ...list(env.MIRA_ALLOWED_HOSTS)],
    staticDir: serveStatic ? path.resolve(process.cwd(), env.MIRA_STATIC_DIR ?? 'dist') : null,
    timeZone: env.MIRA_TIME_ZONE || undefined,
    googleCredentialsConfigured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    logRequests: env.MIRA_LOG_REQUESTS !== 'false',
  }
}
