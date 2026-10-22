import { expect, test } from 'claude-code/testing'
import { profileProject, rateTask } from '../hooks/rules.mjs'

// What Claude Code passes to the band's ui.render hook, apart from the app.
const BAND = {
  plugin: 'effortlevelmod',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const SHOP = ['src/app.ts', 'src/payments/stripe.ts', 'src/auth/login.ts', 'tests/app.test.ts', 'README.md']
const TINY = ['index.html', 'style.css', 'script.js']

// Stubs for everything session.start does, with the project's files as git ls-files output.
function startStubs(on, files: string[]) {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: files.join('\n'), stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other mods'] }))
}

async function runStep($, effort: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

test('rules: a tiny site is low, a shop with payments and auth is high', () => {
  expect(profileProject(TINY).level).toBe('low')
  const shop = profileProject(SHOP)
  expect(shop.level).toBe('high')
  expect(shop.risks).toEqual(['payments', 'auth'])
  expect(shop.hasTests).toBe(true)
  // A CI workflow alone is not risky infrastructure
  expect(profileProject([...TINY, '.github/workflows/ci.yml']).risks).toEqual([])
  expect(profileProject(['infra/main.tf', 'app.py']).risks).toEqual(['infrastructure'])
})

test('rules: tasks map to the levels in the effort docs', () => {
  expect(rateTask('fix the typo in the README', null)!.level).toBe('low')
  expect(rateTask('rename getUser to fetchUser', null)!.level).toBe('low')
  expect(rateTask('add a contact page', null)!.level).toBe('medium')
  expect(rateTask('fix the bug where checkout fails', null)!.level).toBe('high')
  expect(rateTask('refactor the order service across the codebase', null)!.level).toBe('xhigh')
  expect(rateTask('do a security audit of the API', null)!.level).toBe('max')
  // A scoped feature that touches payments needs checking
  expect(rateTask('add stripe checkout', null)!.level).toBe('high')
  // In a project with risky code, a scoped feature moves up too
  expect(rateTask('add a contact page', profileProject(SHOP))!.level).toBe('high')
  expect(rateTask('   ', null)).toBe(null)
})

test('the band shows the project, the task and a switch tip', async ($, on) => {
  startStubs(on, TINY)
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'low' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other mods' })).toBeDefined()
  await ui.unmount()

  // A bug fix, while running at low: the band suggests high
  await $.prompt.submit({ text: 'fix the bug in the contact form' })
  await runStep($, 'low')
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'high' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' → try /effort high' })).toBeDefined()
  await ui.unmount()

  // Running high on that task is a match
  await runStep($, 'high')
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: ' ✓' })).toBeDefined()
  await ui.unmount()
})

test('/effortlevel explains the project, and rates a task typed after it', async ($, on) => {
  startStubs(on, SHOP)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const full = await $.command.run({ command: 'effortlevel', args: '' })
  expect(full.text).toContain('This project suits high effort.')
  expect(full.text).toContain('payments and auth')
  expect(full.text).toContain('ultrathink')

  const one = await $.command.run({ command: 'effortlevel', args: 'rename a variable' })
  expect(one.text).toContain('suits low effort')
  expect(one.text).toContain('/effort low')
})

test('the prompt goes on unchanged, and slash commands are not rated', async ($, on) => {
  startStubs(on, TINY)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const sent = await $.prompt.submit({ text: '/effort high' })
  expect(sent.text).toBe('/effort high')
  const report = await $.command.run({ command: 'effortlevel', args: '' })
  expect(report.text).not.toContain('Your last task')
})

test('outside git it falls back to find, and a failed scan still answers', async ($, on) => {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.invalidate', () => ({ value: undefined }))
  const calls: string[] = []
  on('process.run', ($, e) => {
    calls.push(e.argv[0])
    if (e.argv[0] === 'git') return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }
    return { value: { exitCode: 0, stdout: './a.py\n./b.py\n./migrations/0001.py\n', stderr: '' } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(calls).toEqual(['git', 'find'])
  const report = await $.command.run({ command: 'effortlevel', args: '' })
  expect(report.text).toContain('This project suits high effort.')
  expect(report.text).toContain('database migrations')
})

test('a narrow band keeps the short form', async ($, on) => {
  startStubs(on, TINY)
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.prompt.submit({ text: 'refactor the whole app' })
  await runStep($, 'medium')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 } })
  expect(await ui.find({ type: 'Text', text: ' → xhigh' })).toBeDefined()
  await ui.unmount()
})
