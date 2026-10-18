/**
 * Integration boundary for Google Calendar and Gmail.
 *
 * Today only the demo providers exist. A real implementation plugs in behind the same interfaces once OAuth
 * credentials and the consent flow are in place; the services and routes do not need to change.
 */
import type { ISODate } from '../../shared/dates'
import type { CalendarEvent } from '../../shared/types'

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: string; scope: string }

/** OAuth 2.0 authorisation-code flow with PKCE. Tokens must be stored encrypted and never logged. */
export interface OAuthClient {
  authorizationUrl(state: string, codeChallenge: string): string
  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet>
  refresh(refreshToken: string): Promise<TokenSet>
  revoke(token: string): Promise<void>
}

/** A MIRA work block or deadline written to the user's calendar. `key` makes writes idempotent. */
export type CalendarWrite = { key: string; taskId: string; title: string; date: ISODate; from?: number; to?: number; allDay?: boolean }
export type SyncResult = { created: number; updated: number; deleted: number; unchanged: number }

export interface CalendarProvider {
  readonly kind: 'demo' | 'google'
  listEvents(range: { from: ISODate; to: ISODate }): Promise<CalendarEvent[]>
  /** Creates or updates events by `key` and removes MIRA-owned events whose key is no longer present. */
  syncWrites(writes: CalendarWrite[]): Promise<SyncResult>
}

export type MailMessage = {
  id: string
  from: string
  subject: string
  snippet: string
  receivedAt: string
}

export interface MailProvider {
  readonly kind: 'demo' | 'google'
  /** Messages the user has permitted MIRA to read, newest first. */
  listMessages(opts: { since: string; limit: number }): Promise<MailMessage[]>
}

export type IntegrationFailure = 'not_connected' | 'revoked' | 'rate_limited' | 'unavailable' | 'invalid_response'

export class IntegrationError extends Error {
  constructor(readonly failure: IntegrationFailure, message: string) {
    super(message)
  }
  get retryable() {
    return this.failure === 'rate_limited' || this.failure === 'unavailable'
  }
}

/** Retries transient failures with exponential backoff. Revoked or missing permissions are never retried. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const { retries = 3, baseMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof IntegrationError) || !err.retryable || attempt >= retries) throw err
      await sleep(baseMs * 2 ** attempt)
    }
  }
}
