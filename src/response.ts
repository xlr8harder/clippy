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

export interface ClippyDraft {
  readonly observation: string
  readonly officeTasks: readonly [OfficeTask, OfficeTask, OfficeTask]
}

export const OFFICE_TASKS = Object.freeze(Object.keys(OFFICE_OFFERS) as OfficeTask[])
const OFFICE_TASK_SET = new Set<string>(OFFICE_TASKS)
const MAX_OBSERVATION_CHARS = 360

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse one exact, two-field response. Malformed model output fails closed. */
export function parseClippyDraft(raw: string): ClippyDraft {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: unknown) {
    throw new Error('Clippy model output is not valid JSON', { cause: error })
  }
  if (!plainRecord(parsed)) throw new Error('Clippy model output must be a JSON object')
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== 'observation' || keys[1] !== 'officeTasks') {
    throw new Error('Clippy model output must contain exactly observation and officeTasks')
  }
  if (typeof parsed.observation !== 'string') throw new Error('Clippy observation must be a string')
  let observation = parsed.observation.replace(/\s+/gu, ' ').trim()
  observation = observation.replace(/[.!?]+$/u, '')
  if (observation.length === 0 || observation.length > MAX_OBSERVATION_CHARS) {
    throw new Error(`Clippy observation must contain 1-${MAX_OBSERVATION_CHARS} characters`)
  }
  if (!/^you(?:\s|$)/u.test(observation)) {
    throw new Error('Clippy observation must address the person directly and begin with you')
  }
  if (!Array.isArray(parsed.officeTasks) || parsed.officeTasks.length !== 3
    || parsed.officeTasks.some(task => typeof task !== 'string' || !OFFICE_TASK_SET.has(task))) {
    throw new Error(`Clippy officeTasks must be three values from: ${OFFICE_TASKS.join(', ')}`)
  }
  if (new Set(parsed.officeTasks).size !== parsed.officeTasks.length) {
    throw new Error('Clippy officeTasks must contain three distinct values')
  }
  return {
    observation,
    officeTasks: parsed.officeTasks as unknown as readonly [OfficeTask, OfficeTask, OfficeTask],
  }
}

/**
 * Choose from the model's plausible shortlist. A recent repeat triggers pure
 * Office-era caprice across the rest of the taxonomy.
 */
export function chooseOfficeTask(
  suggestions: readonly [OfficeTask, OfficeTask, OfficeTask],
  recent: readonly OfficeTask[],
  recommendationRoll: number,
  fallbackRoll: number,
): OfficeTask {
  if (!Number.isFinite(recommendationRoll) || recommendationRoll < 0 || recommendationRoll >= 1
    || !Number.isFinite(fallbackRoll) || fallbackRoll < 0 || fallbackRoll >= 1) {
    throw new RangeError('Clippy diversity roll must be in the range [0, 1)')
  }
  const recommended = suggestions[Math.floor(recommendationRoll * suggestions.length)]!
  if (!recent.includes(recommended)) return recommended

  const entireTaxonomy = OFFICE_TASKS.filter(task => !recent.includes(task))
  if (entireTaxonomy.length === 0) throw new Error('Clippy has exhausted the Office taxonomy')
  return entireTaxonomy[Math.floor(fallbackRoll * entireTaxonomy.length)]!
}

export function renderClippyResponse(draft: Pick<ClippyDraft, 'observation'> & { readonly officeTask: OfficeTask }): string {
  return `It looks like ${draft.observation}. Would you like help ${OFFICE_OFFERS[draft.officeTask]}?`
}
