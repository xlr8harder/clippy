import { describe, expect, it } from 'vitest'
import { chooseRandomOfficeTask, OFFICE_TASKS, parseClippyDraft, renderClippyResponse } from './response.ts'

describe('Clippy response boundary', () => {
  const validDraft = {
    kind: 'diagnosis',
    statement: 'you let the queue lease expire before acknowledgement.',
  }

  it('accepts an exact taxonomy response and renders the fixed cadence', () => {
    const draft = parseClippyDraft(JSON.stringify(validDraft))
    expect(renderClippyResponse({ ...draft, officeTask: 'resume' })).toBe(
      'It looks like you let the queue lease expire before acknowledgement. Would you like help drafting a résumé?',
    )
  })

  it('accepts fenced JSON and harmless extra fields from weaker models', () => {
    const normalized = { ...validDraft, statement: validDraft.statement.slice(0, -1) }
    expect(parseClippyDraft(`\`\`\`json\n${JSON.stringify(validDraft)}\n\`\`\``)).toMatchObject(normalized)
    expect(parseClippyDraft(JSON.stringify({ ...validDraft, support: ['legacy excerpt'], joke: true })))
      .toMatchObject(normalized)
  })

  it('rejects observer language instead of calling the person you', () => {
    expect(() => parseClippyDraft(JSON.stringify({
      ...validDraft,
      statement: 'the user configured incompatible service timeouts',
    }))).toThrow(/address the person directly and begin with you/)
  })

  it('chooses uniformly from the full taxonomy without a recent repeat', () => {
    expect(chooseRandomOfficeTask([], 0)).toBe('letter')
    expect(chooseRandomOfficeTask([], 0.999)).toBe('fax')
    expect(chooseRandomOfficeTask(['letter', 'resume', 'memo'], 0)).toBe('report')
    expect(chooseRandomOfficeTask(OFFICE_TASKS, 0.999)).toBe('fax')
    expect(() => chooseRandomOfficeTask([], 1)).toThrow(/range/)
  })

  it('rejects long statements even when the model follows the JSON schema', () => {
    expect(() => parseClippyDraft(JSON.stringify({
      ...validDraft,
      statement: `you ${'made this statement unnecessarily long '.repeat(5)}`,
    }))).toThrow(/1-140 characters/)
  })

  it('requires a known kind but no exact evidence-support ceremony', () => {
    expect(() => parseClippyDraft(JSON.stringify({ ...validDraft, kind: 'guess' })))
      .toThrow(/kind must be one of/)
    expect(parseClippyDraft(JSON.stringify({ ...validDraft, support: [] }))).toMatchObject({
      ...validDraft,
      statement: validDraft.statement.slice(0, -1),
    })
  })
})
