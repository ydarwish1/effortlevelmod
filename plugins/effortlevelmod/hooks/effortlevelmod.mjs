// effortlevelmod: tells you which effort level fits this project and the task
// you just gave Claude, and how that compares with the level you're running.
//
// session.start: adds /effortlevel, then reads the project's file list
//   (git ls-files, or find outside git) and sets a baseline level.
// prompt.submit: rates the prompt you sent. Observe only: the prompt goes on unchanged.
// turn.step: notes the effort level each main-loop request runs at. Observe only:
//   the mod never changes your effort, because a change mid-session can cost
//   you the prompt cache. You switch with /effort when you agree.
// ui.render (AbovePrompt): one line above the prompt.
// command.run (/effortlevel): the full report, or a rating for the text after it.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { LEVELS, WHEN, compare, profileProject, rateTask } from './rules.mjs'

const COLORS = { low: 'green', medium: 'cyan', high: 'yellow', xhigh: 'magenta', max: 'red' }

let project = null // profileProject(...) result
let task = null // { text, level, reasons } for the last prompt
let running = null // the effort level of the last main-loop request

/** @param {import('claude-code').On} on */
export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'effortlevel',
        description: 'Which effort level fits this project, or the task you type after it',
        argumentHint: '[task]',
        immediate: true,
      })
    } catch {
      // The name is taken; the band still works.
    }
    const result = await next(e)
    project = null
    task = null
    await scanProject($)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const text = String(e.text || '')
    if (!text.startsWith('/')) {
      const rated = rateTask(text, project)
      if (rated) {
        task = { text, ...rated }
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  }).catch(async ($, e, next) => {
    // Advice must never block a prompt: if rating fails, send the prompt as typed.
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined && e.effort !== running) {
      running = e.effort
      $.ui.invalidate('ui.render')
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const props = e.props
    if (!props || props.hasSurvey || !project) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const mine = band(Box, Text, props.bodyColumns || 80)
    const others = await next(e)
    return others ? Box({ flexDirection: 'column', children: [mine, others] }) : mine
  })

  on('command.run', { command: 'effortlevel' }, async ($, e) => {
    const args = String(e.args || '').trim()
    if (!project) {
      await scanProject($)
    }
    return { text: args ? forTask(args) : report() }
  })
}

async function scanProject($) {
  try {
    const cwd = await $.session.cwd()
    let out = await $.process.run(['git', 'ls-files'], { cwd, timeoutMs: 15000 })
    if (out.exitCode !== 0) {
      out = await $.process.run(
        ['find', '.', '-type', 'f', '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*'],
        { cwd, timeoutMs: 15000 },
      )
    }
    const paths = out.exitCode === 0 ? out.stdout.split('\n').slice(0, 50000) : []
    project = profileProject(paths)
  } catch {
    project = profileProject([])
  }
  $.ui.invalidate('ui.render')
}

// The band: what the project suits, what the last task suits, what you're on.
function band(Box, Text, columns) {
  const want = task ? task.level : project.level
  const parts = [Text({ bold: true, children: '◆ Effort ' })]
  parts.push(Text({ dimColor: true, children: ' project ' }))
  parts.push(Text({ color: COLORS[project.level], bold: true, children: project.level }))
  if (task) {
    parts.push(Text({ dimColor: true, children: '  ·  this task ' }))
    parts.push(Text({ color: COLORS[task.level], bold: true, children: task.level }))
  }
  if (running !== null) {
    parts.push(Text({ dimColor: true, children: '  ·  running ' }))
    parts.push(Text({ children: String(running) }))
    const c = compare(want, running)
    if (c === 'match') {
      parts.push(Text({ color: 'green', children: ' ✓' }))
    } else if (c !== 'unknown') {
      const tip = c === 'above' ? ' → /effort ' + want + ' saves tokens' : ' → try /effort ' + want
      parts.push(Text({ color: COLORS[want], children: columns >= 70 ? tip : ' → ' + want }))
    }
  } else if (columns >= 70) {
    parts.push(Text({ dimColor: true, children: '  ·  /effortlevel for why' }))
  }
  return Box({ flexDirection: 'row', paddingX: 1, children: parts })
}

function report() {
  const lines = []
  lines.push(`This project suits ${project.level} effort.`)
  for (const r of project.reasons) lines.push(`  - ${r}`)
  if (project.langs.length) lines.push(`  - mostly ${project.langs.join(', ')}`)
  if (task) {
    lines.push('')
    lines.push(`Your last task suits ${task.level}: "${clip(task.text)}"`)
    for (const r of task.reasons) lines.push(`  - ${r}`)
  }
  lines.push('')
  lines.push(running !== null ? `You're running ${running}.` : 'Your running level shows after your first prompt.')
  const want = task ? task.level : project.level
  if (running !== null && compare(want, running) !== 'match' && compare(want, running) !== 'unknown') {
    lines.push(`Switch with /effort ${want} (or press s in the /effort slider for this session only).`)
  }
  lines.push('')
  lines.push('When each level fits:')
  for (const l of LEVELS) lines.push(`  ${l.padEnd(6)} ${WHEN[l]}`)
  lines.push('')
  lines.push('For one hard prompt, add the word ultrathink instead of switching. Changing effort mid-session can cost you the prompt cache.')
  lines.push('This is a rule of thumb from your files and your words. You know the job better.')
  return lines.join('\n')
}

function forTask(text) {
  const rated = rateTask(text, project)
  const lines = [`"${clip(text)}" suits ${rated.level} effort.`]
  for (const r of rated.reasons) lines.push(`  - ${r}`)
  lines.push(`  - ${rated.level}: ${WHEN[rated.level]}`)
  lines.push(`Switch with /effort ${rated.level}.`)
  return lines.join('\n')
}

function clip(text) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 57) + '...' : t
}
