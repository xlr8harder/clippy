/** Fixed Office-era lens and strict model-output boundary. */

export const OFFICE_OFFERS = {
  letter: 'writing a letter',
  resume: 'drafting a résumé',
  memo: 'preparing a memo',
  report: 'creating a report',
  agenda: 'making a meeting agenda',
  presentation: 'building a presentation',
  newsletter: 'designing a newsletter',
  spreadsheet: 'organizing this in a spreadsheet',
  chart: 'turning this into a chart',
  envelope: 'addressing an envelope',
  label: 'printing some labels',
  fax: 'creating a fax cover sheet',
} as const

export type OfficeTask = keyof typeof OFFICE_OFFERS
export const STATEMENT_KINDS = ['diagnosis', 'observation', 'workflow'] as const
export type StatementKind = (typeof STATEMENT_KINDS)[number]
const STATEMENT_KIND_SET = new Set<string>(STATEMENT_KINDS)

export interface ClippyDraft {
  readonly kind: StatementKind
  readonly support: readonly [string] | readonly [string, string]
  readonly statement: string
}

export const OFFICE_TASKS = Object.freeze(Object.keys(OFFICE_OFFERS) as OfficeTask[])
const MAX_STATEMENT_CHARS = 140
const MIN_SUPPORT_CHARS = 12
const MAX_SUPPORT_CHARS = 240

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse one exact model draft. Malformed output fails closed. */
export function parseClippyDraft(raw: string): ClippyDraft {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: unknown) {
    throw new Error('Clippy model output is not valid JSON', { cause: error })
  }
  if (!plainRecord(parsed)) throw new Error('Clippy model output must be a JSON object')
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 3 || keys[0] !== 'kind' || keys[1] !== 'statement' || keys[2] !== 'support') {
    throw new Error('Clippy model output must contain exactly kind, support, and statement')
  }
  if (typeof parsed.kind !== 'string' || !STATEMENT_KIND_SET.has(parsed.kind)) {
    throw new Error(`Clippy kind must be one of: ${STATEMENT_KINDS.join(', ')}`)
  }
  if (!Array.isArray(parsed.support) || parsed.support.length < 1 || parsed.support.length > 2
    || parsed.support.some(excerpt => typeof excerpt !== 'string')) {
    throw new Error('Clippy support must contain one or two strings')
  }
  const support = parsed.support.map(excerpt => (excerpt as string).replace(/\s+/gu, ' ').trim())
  if (support.some(excerpt => excerpt.length < MIN_SUPPORT_CHARS || excerpt.length > MAX_SUPPORT_CHARS)) {
    throw new Error(`Clippy support excerpts must contain ${MIN_SUPPORT_CHARS}-${MAX_SUPPORT_CHARS} characters`)
  }
  if (new Set(support).size !== support.length) {
    throw new Error('Clippy support excerpts must be distinct')
  }
  if (typeof parsed.statement !== 'string') throw new Error('Clippy statement must be a string')
  let statement = parsed.statement.replace(/\s+/gu, ' ').trim()
  statement = statement.replace(/[.!?]+$/u, '')
  if (statement.length === 0 || statement.length > MAX_STATEMENT_CHARS) {
    throw new Error(`Clippy statement must contain 1-${MAX_STATEMENT_CHARS} characters`)
  }
  if (!/^you(?:\s|$)/u.test(statement)) {
    throw new Error('Clippy statement must address the person directly and begin with you')
  }
  return {
    kind: parsed.kind as StatementKind,
    support: support as unknown as readonly [string] | readonly [string, string],
    statement,
  }
}

/** Choose uniformly from the full taxonomy while preserving recent-offer diversity. */
export function chooseRandomOfficeTask(recent: readonly OfficeTask[], roll: number): OfficeTask {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError('Clippy diversity roll must be in the range [0, 1)')
  }
  const nonRepeating = OFFICE_TASKS.filter(task => !recent.includes(task))
  const choices = nonRepeating.length === 0 ? OFFICE_TASKS : nonRepeating
  return choices[Math.floor(roll * choices.length)]!
}

export function renderClippyResponse(draft: Pick<ClippyDraft, 'statement'> & { readonly officeTask: OfficeTask }): string {
  return `It looks like ${draft.statement}. Would you like help ${OFFICE_OFFERS[draft.officeTask]}?`
}
