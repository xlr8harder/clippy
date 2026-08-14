import { describe, expect, it } from 'vitest'
import { chooseRandomOfficeTask, OFFICE_TASKS, parseClippyDraft, renderClippyResponse } from './response.ts'

describe('Clippy response boundary', () => {
  const validDraft = {
    kind: 'diagnosis',
    support: [
      'visibility_timeout: 3s; acknowledgement_deadline: 5s',
      'lease expired; redelivered; ack accepted by original worker',
    ],
    statement: 'you let the queue lease expire before acknowledgement.',
  }

  it('accepts an exact taxonomy response and renders the fixed cadence', () => {
    const draft = parseClippyDraft(JSON.stringify(validDraft))
    expect(renderClippyResponse({ ...draft, officeTask: 'resume' })).toBe(
      'It looks like you let the queue lease expire before acknowledgement. Would you like help drafting a résumé?',
    )
  })

  it('rejects prose wrappers, unknown fields, and invented taxonomy values', () => {
    expect(() => parseClippyDraft(`\`\`\`json\n${JSON.stringify(validDraft)}\n\`\`\``))
      .toThrow(/not valid JSON/)
    expect(() => parseClippyDraft(JSON.stringify({ ...validDraft, joke: true })))
      .toThrow(/exactly kind, support, and statement/)
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

  it('requires a known kind and one or two substantial support excerpts', () => {
    expect(() => parseClippyDraft(JSON.stringify({ ...validDraft, kind: 'guess' })))
      .toThrow(/kind must be one of/)
    expect(() => parseClippyDraft(JSON.stringify({ ...validDraft, support: [] })))
      .toThrow(/one or two strings/)
    expect(() => parseClippyDraft(JSON.stringify({ ...validDraft, support: ['too short'] })))
      .toThrow(/12-240 characters/)
  })
})
