import { describe, expect, it } from 'vitest'
import { chooseOfficeTask, parseClippyDraft, renderClippyResponse } from './response.ts'

describe('Clippy response boundary', () => {
  it('accepts an exact taxonomy response and renders the fixed cadence', () => {
    const draft = parseClippyDraft(JSON.stringify({
      observation: 'you have been bisecting a duplicate-delivery race for 47 minutes.',
      officeTasks: ['resume', 'spreadsheet', 'fax'],
    }))
    expect(renderClippyResponse({ ...draft, officeTask: draft.officeTasks[0] })).toBe(
      'It looks like you have been bisecting a duplicate-delivery race for 47 minutes. Would you like help drafting a résumé?',
    )
  })

  it('rejects prose wrappers, unknown fields, and invented taxonomy values', () => {
    expect(() => parseClippyDraft('```json\n{"observation":"you are writing","officeTasks":["memo","fax","chart"]}\n```'))
      .toThrow(/not valid JSON/)
    expect(() => parseClippyDraft('{"observation":"you are writing","officeTasks":["memo","fax","chart"],"joke":true}'))
      .toThrow(/exactly observation and officeTasks/)
    expect(() => parseClippyDraft('{"observation":"you are writing","officeTasks":["debugger","fax","chart"]}'))
      .toThrow(/officeTasks must be three values/)
  })

  it('rejects observer language instead of calling the person you', () => {
    expect(() => parseClippyDraft(JSON.stringify({
      observation: 'the user is writing a distributed systems incident analysis',
      officeTasks: ['memo', 'fax', 'chart'],
    }))).toThrow(/address the person directly and begin with you/)
  })

  it('selects among recommendations and uses the full taxonomy to break a repeat', () => {
    const suggestions = ['spreadsheet', 'chart', 'fax'] as const
    expect(chooseOfficeTask(suggestions, [], 0.2, 0)).toBe('spreadsheet')
    expect(chooseOfficeTask(suggestions, [], 0.5, 0)).toBe('chart')
    expect(chooseOfficeTask(suggestions, [], 0.9, 0)).toBe('fax')
    const fallback = chooseOfficeTask(suggestions, ['spreadsheet', 'chart', 'fax'], 0.2, 0.5)
    expect(['spreadsheet', 'chart', 'fax']).not.toContain(fallback)
  })

  it('requires three distinct model-ranked alternatives', () => {
    expect(() => parseClippyDraft(JSON.stringify({
      observation: 'you are comparing latency figures',
      officeTasks: ['spreadsheet', 'spreadsheet', 'chart'],
    }))).toThrow(/three distinct values/)
  })
})
