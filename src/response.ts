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
  readonly statement: string
}

export const OFFICE_TASKS = Object.freeze(Object.keys(OFFICE_OFFERS) as OfficeTask[])
const MAX_STATEMENT_CHARS = 140

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  return fenced?.[1] ?? trimmed
}

/** Parse one short model draft while tolerating harmless legacy fields. */
export function parseClippyDraft(raw: string): ClippyDraft {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapJson(raw))
  } catch (error: unknown) {
    throw new Error('Clippy model output is not valid JSON', { cause: error })
  }
  if (!plainRecord(parsed)) throw new Error('Clippy model output must be a JSON object')
  if (typeof parsed.kind !== 'string' || !STATEMENT_KIND_SET.has(parsed.kind)) {
    throw new Error(`Clippy kind must be one of: ${STATEMENT_KINDS.join(', ')}`)
  }
  if (typeof parsed.statement !== 'string') throw new Error('Clippy statement must be a string')
  let statement = parsed.statement.replace(/\s+/gu, ' ').trim()
  statement = statement.replace(/[.!?]+$/u, '')
  if (statement.length === 0 || statement.length > MAX_STATEMENT_CHARS) {
    throw new Error(`Clippy statement must contain 1-${MAX_STATEMENT_CHARS} characters`)
  }
  const beginsWithYou = /^you(?:\s|$)/u.test(statement)
  const beginsWithYourSubject = parsed.kind === 'observation' && /^your\s+\S+/u.test(statement)
  if (!beginsWithYou && !beginsWithYourSubject) {
    throw new Error('Clippy statement must begin with you, or your plus a subject for an observation')
  }
  return {
    kind: parsed.kind as StatementKind,
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
