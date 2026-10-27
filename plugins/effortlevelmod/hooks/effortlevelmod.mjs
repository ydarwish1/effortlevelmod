// effortlevelmod: tells you which effort level fits the task you just gave
// Claude, why, and how that compares with the level you're running.
//
// session.start: adds /effortlevel.
// prompt.submit: starts a rating of the prompt you sent. Observe only: the
//   prompt goes on unchanged and never waits for the rating.
// turn.complete: keeps the end of Claude's last reply, so "yes, do it" is
//   rated as the work it approves.
// turn.step: notes which main-loop turn is running and the effort level each of
//   its requests runs at, and gives an armed message's turn its boost. On its own
//   the mod never changes your effort. Only when you press Ultrathink (or type
//   /ultra) does it send that one turn's requests at xhigh, the level the
//   ultrathink keyword uses, and your /effort setting stays as it was.
// ui.render (AbovePrompt): the level and the reason, above the prompt, and the
//   Ultrathink button: before you send, it arms your next message; while
//   Claude is working, it raises the rest of that turn. The band and its button
//   draw in the terminal and in the Desktop app.
// command.run (/effortlevel): the full report, or a rating for the text after it.
// command.run (/ultra): the same as the button, for places without the band.
//
// A rating is one Haiku call with the brief in rules.mjs. When that call
// fails, the word rules in rules.mjs rate the task instead.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { LEVELS, RATER, WHEN, clipWords, compare, parseRating, raterPrompt, rateTask } from './rules.mjs'

const COLORS = { low: 'green', medium: 'cyan', high: 'yellow', xhigh: 'magenta', max: 'red' }

let task = null // { text, pending } while rating, then { text, level, why, by }
let running = null // the effort level of the last main-loop request
let lastReply = '' // the end of Claude's last main-loop reply
let rating = 0 // counts prompts, so a slow rating never replaces a newer one
let armed = false // Ultrathink pressed: the next message you send gets the boost
let boostNext = false // the next main-loop turn to start gets the boost
let boostTurn = null // the main-loop turn running at xhigh, by its turnId
let currentTurn = null // the main-loop turn in progress, by its turnId

/** @param {import('claude-code').On} on */
export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'effortlevel',
        description: 'Which effort level fits your last task, or the task you type after it, and why',
        argumentHint: '[task]',
        immediate: true,
      })
    } catch {
      // The name is taken; the band still works.
    }
    try {
      await $.command.register({
        name: 'ultra',
        description: 'Ultrathink: run your next message (or, while Claude works, the rest of this turn) at xhigh effort',
        immediate: true,
      })
    } catch {
      // The name is taken; the button still works.
    }
    const result = await next(e)
    task = null
    lastReply = ''
    armed = false
    boostNext = false
    boostTurn = null
    currentTurn = null
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const text = String(e.text || '')
    if (text.trim() && !text.startsWith('/') && !e.isMeta) {
      if (armed) {
        armed = false
        boostNext = true
      }
      const mine = ++rating
      const reply = lastReply
      task = { text, pending: true }
      $.ui.invalidate('ui.render')
      // The rating outlives this hook, so it runs in a timer's dispatch of its own.
      $.clock.after(1, () => rateLater($, mine, text, reply))
    }
    return next(e)
  }).catch(async ($, e, next) => {
    // Advice must never block a prompt: if rating fails, send the prompt as typed.
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      if (typeof e.answer === 'string' && e.answer.trim()) {
        lastReply = e.answer.slice(-600)
      }
      if (boostTurn !== null && e.turnId === boostTurn) {
        boostTurn = null
        $.ui.invalidate('ui.render')
      }
      if (e.turnId === currentTurn) currentTurn = null
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      currentTurn = e.turnId
      // An armed message gets its boost on its turn's first request.
      if (boostNext && e.index === 0) {
        boostNext = false
        boostTurn = e.turnId
        $.ui.invalidate('ui.render')
      }
    }
    if (!e.agentId && e.effort !== undefined && e.effort !== running) {
      running = e.effort
      $.ui.invalidate('ui.render')
    }
    if (!e.agentId && boostTurn !== null && e.turnId === boostTurn) {
      const effort = boosted(e.model, e.effort)
      if (effort) return yield* next({ ...e, effort })
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const props = e.props
    if (!props || props.hasSurvey) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const press = () => {
      pressUltrathink(Boolean(props.isWorking))
      $.ui.invalidate('ui.render')
    }
    const ultra = ultraRow(Box, Text, Button, Boolean(props.isWorking), press)
    const mine = band(Box, Text, props.bodyColumns || 80, ultra)
    const others = await next(e)
    return others ? Box({ flexDirection: 'column', children: [mine, others] }) : mine
  })

  on('command.run', { command: 'ultra' }, async ($) => {
    const said = pressUltrathink(currentTurn !== null)
    $.ui.invalidate('ui.render')
    await $.ui.toast(said)
    return {}
  })

  on('command.run', { command: 'effortlevel' }, async ($, e) => {
    const args = String(e.args || '').trim()
    if (!args) {
      return { text: report() }
    }
    const rated = await rateWithModel($, args, lastReply)
    return { text: forTask(args, rated) }
  })
}

/**
 * @param {import('claude-code').EngineInterface} $
 * @param {number} mine
 * @param {string} text
 * @param {string} reply
 */
async function rateLater($, mine, text, reply) {
  const rated = await rateWithModel($, text, reply)
  if (mine !== rating) return
  task = { text, ...rated }
  $.ui.invalidate('ui.render')
}

// One Haiku call; the word rules when it fails or answers something unreadable.
/**
 * @param {import('claude-code').EngineInterface} $
 * @param {string} text
 * @param {string} reply
 */
async function rateWithModel($, text, reply) {
  try {
    const answer = await $.model.complete({
      model: 'haiku',
      system: RATER,
      prompt: raterPrompt(text, reply),
      maxTokens: 200,
      effort: 'low',
      timeoutMs: 20000,
    })
    const rated = answer.isAnswered ? parseRating(answer.text) : null
    if (rated) return { ...rated, by: 'model' }
  } catch {
    // A refused request: fall through to the rules.
  }
  return { ...rateTask(text), by: 'rules' }
}

// What a press of Ultrathink does: while a turn runs, raise the rest of it;
// otherwise arm (or disarm) the next message. Returns a line saying so.
function pressUltrathink(working) {
  if (working && currentTurn !== null) {
    if (boostTurn === currentTurn) {
      boostTurn = null
      return 'Ultrathink off: the rest of this turn goes back to your level.'
    }
    boostTurn = currentTurn
    return 'Ultrathink on: the rest of this turn runs at xhigh.'
  }
  armed = !armed
  return armed ? 'Ultrathink on: your next message runs at xhigh.' : 'Ultrathink off for your next message.'
}

// The effort a boosted request runs at: xhigh, the level the ultrathink keyword
// uses, never lower than what you already run, and nothing for a model with no
// effort. Opus 4.6 and Sonnet 4.6 have no xhigh, so they get high.
function boosted(model, effort) {
  if (effort === undefined || typeof effort === 'number') return null
  const want = /4[-._]6/.test(String(model || '')) ? 'high' : 'xhigh'
  return LEVELS.indexOf(effort) >= LEVELS.indexOf(want) ? null : want
}

// The Ultrathink row: one button, and what it will do or is doing.
function ultraRow(Box, Text, Button, working, onPress) {
  const live = working && currentTurn !== null
  const on = live ? boostTurn === currentTurn && boostTurn !== null : armed
  const label = live ? (on ? '⚡ Ultrathinking this turn' : '⚡ Ultrathink this turn') : (on ? '⚡ Ultrathink next: on' : '⚡ Ultrathink next message')
  const parts = [Button({ key: 'ultrathink', label, hotkey: '0', plain: true, onPress })]
  const done = task && !task.pending ? task : null
  if (on) {
    parts.push(Text({ color: COLORS.xhigh, children: live ? '  this turn runs at xhigh' : '  your next message runs at xhigh' }))
  } else if (live && done && (done.level === 'xhigh' || done.level === 'max')) {
    parts.push(Text({ color: COLORS[done.level], children: '  ← this task needs it' }))
  }
  return Box({ flexDirection: 'row', paddingX: 3, children: parts })
}

// The band: this task's level and why, and what you're running.
function band(Box, Text, columns, ultra) {
  const head = [Text({ bold: true, children: '◆ Effort ' })]
  const done = task && !task.pending ? task : null
  if (!task) {
    head.push(Text({ dimColor: true, children: columns >= 70 ? ' rates each task you send  ·  /effortlevel <task> rates one first' : ' rates each task you send' }))
  } else if (!done) {
    head.push(Text({ dimColor: true, children: ' rating this task…' }))
  } else {
    head.push(Text({ dimColor: true, children: ' this task ' }))
    head.push(Text({ color: COLORS[done.level], bold: true, children: done.level }))
  }
  if (running !== null) {
    head.push(Text({ dimColor: true, children: '  ·  running ' }))
    head.push(Text({ children: String(running) }))
    const c = done ? compare(done.level, running) : 'unknown'
    if (c === 'match') {
      head.push(Text({ color: 'green', children: ' ✓' }))
    } else if (c !== 'unknown') {
      const tip = c === 'above' ? ' → /effort ' + done.level + ' saves tokens' : ' → try /effort ' + done.level
      head.push(Text({ color: COLORS[done.level], children: columns >= 70 ? tip : ' → ' + done.level }))
    }
  }
  const rows = [Box({ flexDirection: 'row', paddingX: 1, children: head })]
  if (done) {
    const why = (done.by === 'rules' ? 'word rules: ' : '') + done.why
    rows.push(Box({ flexDirection: 'row', paddingX: 3, children: [Text({ dimColor: true, children: clipWords(why, Math.max(20, columns - 6)) })] }))
  }
  if (ultra) rows.push(ultra)
  return Box({ flexDirection: 'column', children: rows })
}

function report() {
  const lines = []
  const done = task && !task.pending ? task : null
  if (done) {
    lines.push(`Your last task suits ${done.level} effort: "${clip(done.text, 60)}"`)
    lines.push(`  why: ${done.why}`)
    if (done.by === 'rules') lines.push('  (rated by word rules: the rating model was not reachable)')
  } else if (task) {
    lines.push(`Your last task is still being rated: "${clip(task.text, 60)}"`)
  } else {
    lines.push('No task rated yet. Send one, or type /effortlevel <task> to rate it first.')
  }
  lines.push('')
  lines.push(running !== null ? `You're running ${running}.` : 'Your running level shows after your first prompt.')
  if (done && running !== null && compare(done.level, running) !== 'match' && compare(done.level, running) !== 'unknown') {
    lines.push(`Switch with /effort ${done.level} (or press s in the /effort slider for this session only).`)
  }
  lines.push('')
  lines.push('When each level fits:')
  for (const l of LEVELS) lines.push(`  ${l.padEnd(6)} ${WHEN[l]}`)
  lines.push('')
  lines.push('For one hard prompt, press Ultrathink above the prompt (or type /ultra, or add the word ultrathink) instead of switching: that one turn runs at xhigh and your setting stays.')
  lines.push('Haiku rates each task from your words and the end of Claude\'s last reply. You know the job better.')
  return lines.join('\n')
}

function forTask(text, rated) {
  const lines = [`"${clip(text, 60)}" suits ${rated.level} effort.`]
  lines.push(`  why: ${rated.why}`)
  if (rated.by === 'rules') lines.push('  (rated by word rules: the rating model was not reachable)')
  lines.push(`  ${rated.level}: ${WHEN[rated.level]}`)
  lines.push(`Switch with /effort ${rated.level}.`)
  return lines.join('\n')
}

function clip(text, max) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 3) + '...' : t
}
