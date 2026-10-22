import { expect, mock, test } from 'claude-code/testing'
import { clipWords, parseRating, raterPrompt, rateTask, RATER } from '../hooks/rules.mjs'

// What Claude Code passes to the band's ui.render hook, apart from the app.
const BAND = {
  plugin: 'effortlevelmod',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE = { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Stubs for everything the mod calls. `answer` stands for the rating model:
// it gets the task and gives the model's text, or null for a failed call.
function stubs(on, answer: (task: string) => string | null | Promise<string | null>) {
  const asked: { model: string; prompt: string; system?: string }[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other mods'] }))
  on('model.complete', async ($, e) => {
    asked.push(e)
    const text = await answer(e.prompt.split('Task: ').pop() || '')
    return text === null
      ? { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
      : { value: { isAnswered: true, text, usage: USAGE } }
  })
  return asked
}

const rated = (level: string, why: string) => JSON.stringify({ level, why })

async function runStep($, effort: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

test('rules: the rating answer is read safely', () => {
  expect(parseRating(rated('high', 'A bug fix in auth.'))).toEqual({ level: 'high', why: 'a bug fix in auth' })
  expect(parseRating('```json\n{"level":"XHIGH","why":"API rewrite"}\n```')).toEqual({ level: 'xhigh', why: 'API rewrite' })
  expect(parseRating(rated('extreme', 'too much'))).toBe(null)
  expect(parseRating('high, because it is a bug')).toBe(null)
  expect(parseRating('{"level":')).toBe(null)
  // No reason: the level's own meaning stands in
  expect(parseRating('{"level":"low"}')!.why).toContain('quick exchanges')
  // A long reason is cut at a word break
  const long = parseRating(rated('medium', 'word '.repeat(40)))!.why
  expect(long.length).toBeLessThanOrEqual(90)
  expect(long.endsWith('word…')).toBe(true)
  expect(clipWords('short', 90)).toBe('short')
})

test('rules: the rater gets the last reply and the task, and the brief covers every level', () => {
  const prompt = raterPrompt('yes, do it', 'I can rename the three files and fix their imports. Go ahead?')
  expect(prompt).toContain("Claude's last reply")
  expect(prompt).toContain('I can rename the three files')
  expect(prompt.endsWith('Task: yes, do it')).toBe(true)
  expect(raterPrompt('add a page', '')).toBe('Task: add a page')
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) expect(RATER).toContain(`- ${level}:`)
})

test('rules: the word rules still rate a task when the model is out', () => {
  expect(rateTask('fix the typo in the README')!.level).toBe('low')
  expect(rateTask('rename getUser to fetchUser')!.level).toBe('low')
  expect(rateTask('add a contact page')!.level).toBe('medium')
  expect(rateTask('fix the bug where checkout fails')!.level).toBe('high')
  expect(rateTask('refactor the order service across the codebase')!.level).toBe('xhigh')
  expect(rateTask('do a security audit of the API')!.level).toBe('max')
  // A scoped feature that names payments needs checking
  expect(rateTask('add stripe checkout')).toEqual({ level: 'high', why: 'a change that touches payments' })
  expect(rateTask('   ')).toBe(null)
})

test('the band shows the rating, its reason and a switch tip', async ($, on) => {
  const clock = mock.clock(on)
  const asked = stubs(on, (task) => (task.includes('contact form') ? rated('high', 'a bug fix in a live form, where edge cases matter') : null))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  // Before any task: what it does, and the other mods' band below
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /rates each task you send/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other mods' })).toBeDefined()
  await ui.unmount()

  // Sent, not rated yet
  await $.prompt.submit({ text: 'fix the bug in the contact form' })
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /rating this task/ })).toBeDefined()
  await ui.unmount()

  // Rated, while running low: the band says high, why, and how to switch
  await clock.advance(1)
  await runStep($, 'low')
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'high' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a bug fix in a live form, where edge cases matter' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' → try /effort high' })).toBeDefined()
  await ui.unmount()
  expect(asked).toHaveLength(1)
  expect(asked[0].model).toBe('haiku')
  expect(asked[0].system).toBe(RATER)

  // Running high on that task is a match
  await runStep($, 'high')
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: ' ✓' })).toBeDefined()
  await ui.unmount()
})

test('running above the rating suggests the lower level to save tokens', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, () => rated('low', 'a one-word text fix'))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'fix the typo in the footer' })
  await clock.advance(1)
  await runStep($, 'xhigh')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: ' → /effort low saves tokens' })).toBeDefined()
  await ui.unmount()
})

test('a failed rating falls back to the word rules, and says so', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, () => null)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'rename getUser to fetchUser' })
  await clock.advance(1)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'low' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'word rules: a small edit like a rename or a typo' })).toBeDefined()
  await ui.unmount()

  const one = await $.command.run({ command: 'effortlevel', args: 'add stripe checkout' })
  expect(one.text).toContain('suits high effort')
  expect(one.text).toContain('word rules')
})

test('an answer with no level falls back to the word rules too', async ($, on) => {
  stubs(on, () => 'I think this is a medium task.')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const one = await $.command.run({ command: 'effortlevel', args: 'refactor the whole app' })
  expect(one.text).toContain('suits xhigh effort')
  expect(one.text).toContain('word rules')
})

test('/effortlevel rates the task typed after it, with the reason', async ($, on) => {
  const asked = stubs(on, (task) => (task.includes('contact page') ? rated('medium', 'a scoped page with a clear goal') : null))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const before = await $.command.run({ command: 'effortlevel', args: '' })
  expect(before.text).toContain('No task rated yet')
  expect(before.text).toContain('ultrathink')
  expect(asked).toHaveLength(0)

  const one = await $.command.run({ command: 'effortlevel', args: 'add a contact page' })
  expect(one.text).toContain('"add a contact page" suits medium effort.')
  expect(one.text).toContain('why: a scoped page with a clear goal')
  expect(one.text).toContain('Switch with /effort medium.')
  expect(one.text).not.toContain('word rules')
})

test('"yes, do it" is rated as the work Claude proposed', async ($, on) => {
  const clock = mock.clock(on)
  const asked = stubs(on, (task) => (task === 'yes, do it' ? rated('low', 'approves a small rename Claude proposed') : null))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't1', answer: 'I can rename the three files and fix their imports. Go ahead?', durationMs: 5, isAborted: false, reason: 'answer' })
  // A subagent's report is not the reply the person answers
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'SUBAGENT REPORT', durationMs: 5, isAborted: false, reason: 'answer' })

  await $.prompt.submit({ text: 'yes, do it' })
  await clock.advance(1)
  expect(asked).toHaveLength(1)
  expect(asked[0].prompt).toContain('I can rename the three files and fix their imports')
  expect(asked[0].prompt).not.toContain('SUBAGENT')

  const report = await $.command.run({ command: 'effortlevel', args: '' })
  expect(report.text).toContain('Your last task suits low effort: "yes, do it"')
  expect(report.text).toContain('why: approves a small rename Claude proposed')
})

test('the prompt goes on unchanged, and slash commands are not rated', async ($, on) => {
  const clock = mock.clock(on)
  const asked = stubs(on, () => rated('high', 'should not be asked'))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const sent = await $.prompt.submit({ text: '/effort high' })
  expect(sent.text).toBe('/effort high')
  await clock.advance(1)
  expect(asked).toHaveLength(0)
  const report = await $.command.run({ command: 'effortlevel', args: '' })
  expect(report.text).toContain('No task rated yet')
})

test('a slow rating never replaces a newer one', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, async (task) => {
    if (task === 'first task') {
      await clock.sleep(5000)
      return rated('max', 'the old, slow rating')
    }
    return rated('low', 'the newer rating')
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'first task' })
  await clock.advance(1)
  await $.prompt.submit({ text: 'second task' })
  await clock.advance(1)
  await clock.advance(5000)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'low' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'max' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow band keeps the short form', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, () => rated('xhigh', 'a rewrite across the whole app, touching every module and every test'))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'refactor the whole app' })
  await clock.advance(1)
  await runStep($, 'medium')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 } })
  expect(await ui.find({ type: 'Text', text: ' → xhigh' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a rewrite across the whole app, touching…' })).toBeDefined()
  await ui.unmount()
})
