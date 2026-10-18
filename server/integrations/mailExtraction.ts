import type { ISODate } from '../../shared/dates'
import { findDateInText } from '../../shared/quickAdd'
import type { MailSuggestion } from '../../shared/types'
import type { MailMessage } from './types'

const RULES: [MailSuggestion['kind'], RegExp][] = [
  ['Deadline', /\b(submit|submission|deadline|due|no later than)\b/i],
  ['Request', /\b(can you|could you|please review|review)\b/i],
  ['Follow-up', /\b(follow-?up|let me know)\b/i],
]

/** Rule-based detection of messages that look like work. Returns null for messages that are not task-like. */
export function extractSuggestion(msg: MailMessage, today: ISODate): Omit<MailSuggestion, 'importedTaskId'> | null {
  const text = `${msg.subject}\n${msg.snippet}`
  const kind = RULES.find(([, re]) => re.test(text))?.[0]
  if (!kind) return null
  const deadline = findDateInText(msg.snippet, today) ?? findDateInText(msg.subject, today)
  return { id: msg.id, from: msg.from, subject: msg.subject, snippet: msg.snippet, kind, deadline }
}
