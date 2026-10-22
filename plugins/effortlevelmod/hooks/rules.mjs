// effortlevelmod: the rules, as plain functions with no mods API calls,
// so the tests can check them directly.
//
// A task is rated by a small model (Haiku) with the RATER brief below. The
// word rules at the bottom are the fallback for when that call fails.
//
// The level meanings follow Claude Code's effort docs
// (https://code.claude.com/docs/en/model-config#choose-an-effort-level) and
// the "Spending your effort" post. How a task maps to a level is this mod's
// own judgment, not an official setting.

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

// When each level fits, in the docs' words where possible.
export const WHEN = {
  low: 'quick exchanges you review: a question, a rename, a typo, a first sketch, brainstorming',
  medium: 'day-to-day work with a clear scope, like a new feature (the Opus 5.5 default)',
  high: 'work where checking matters: fixing a bug in existing code, tests, migrations',
  xhigh: 'deeper reasoning: architecture, big refactors, performance, concurrency',
  max: 'hard problems Claude works through alone, like a security audit (test first, it can overthink)',
}

// The brief the rating model gets as its system prompt.
export const RATER = `You pick the Claude Code effort level for one task a person just sent to Claude Code, a coding agent. Effort sets how much Claude thinks, checks and tests before it answers. A higher level costs more tokens and time. It pays off when edge cases or verification matter, or when the task is underspecified and Claude must make many choices alone. It does not help Claude read a task correctly.

The levels:
- low: quick exchanges the person reviews and steers: a question, an explanation, brainstorming, a first sketch, a small obvious edit (a rename, a typo, a wording change, one config value), or running a command and reporting.
- medium: everyday engineering with a clear scope: build a specified feature, page, endpoint, component or script; a routine change in one area. This is the default, and most tasks are low or medium.
- high: verification matters or edge cases are likely: fix a bug or a failing test in existing code, debug an error, write tests, a database migration or a dependency upgrade, a refactor in a live codebase, or a change to auth, payments or data handling where a mistake is costly.
- xhigh: deep reasoning across a lot of code: an architecture or design decision, a large cross-cutting refactor or rewrite, performance work, concurrency or race conditions, a hard bug that earlier attempts did not fix, a big underspecified build where the details matter.
- max: hard problems the person wants Claude to work through alone for a long time: a security audit or a hunt for vulnerabilities, a complete app built and verified end to end, research-grade problems. It can overthink, so pick it only when the task clearly asks for that depth.

How to judge:
- Rate the work this task asks for.
- "Quick", "just" and "small" pull the level down. "Thoroughly", "make sure", "prove", "end to end" and "production" pull it up.
- A short reply such as "yes", "do it", "go ahead" or "continue" approves what Claude proposed last. Rate that work, from Claude's last reply.
- A question about code is low, unless it asks Claude to investigate a fault ("why does X sometimes fail" is high).
- When you are unsure between two levels, pick the lower one.

Examples:
"fix the typo in the header" -> {"level":"low","why":"a one-word text fix you can check at a glance"}
"what does useEffect cleanup do?" -> {"level":"low","why":"a question to answer, with no code to change"}
"add a dark mode toggle to the settings page" -> {"level":"medium","why":"a scoped UI feature with a clear goal"}
"checkout sometimes charges twice, find out why" -> {"level":"high","why":"an intermittent payments bug where edge cases matter"}
"move the whole app from REST to GraphQL" -> {"level":"xhigh","why":"a cross-cutting rewrite of every data path"}
"audit the API for security holes" -> {"level":"max","why":"a long, autonomous hunt for vulnerabilities"}

Answer with JSON only, no other text: {"level":"low|medium|high|xhigh|max","why":"the reason for this task, at most 10 words"}`

// The one user message the rating model gets: Claude's last reply (so
// "yes, do it" means something), then the task.
export function raterPrompt(task, lastReply) {
  const lines = []
  const reply = String(lastReply || '').replace(/\s+/g, ' ').trim()
  if (reply) lines.push(`Claude's last reply (its end): "${reply.slice(-600)}"`)
  lines.push(`Task: ${String(task || '').trim().slice(0, 2000)}`)
  return lines.join('\n')
}

// Reads the rating model's answer. Returns { level, why }, or null when the
// answer holds no known level.
export function parseRating(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  let data
  try {
    data = JSON.parse(match[0])
  } catch {
    return null
  }
  const level = String((data && data.level) || '').trim().toLowerCase()
  if (!LEVELS.includes(level)) return null
  let why = String((data && data.why) || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '')
  if (/^[A-Z](?![A-Z])/.test(why)) why = why[0].toLowerCase() + why.slice(1)
  if (!why) why = WHEN[level]
  return { level, why: clipWords(why, 90) }
}

// Cuts text to at most max characters, at a word break.
export function clipWords(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '') + '…'
}

// Areas where a wrong change is costly, matched against the task's words.
const RISKS = [
  { name: 'payments', pattern: /(^|[\/._-])(payments?|billing|stripe|checkout|invoices?|paypal|subscriptions?)([\/._-]|$)/i },
  { name: 'auth', pattern: /(^|[\/._-])(auth|oauth|login|signin|sessions?|passwords?|jwt)([\/._-]|$)/i },
  { name: 'database migrations', pattern: /(^|\/)(migrations?|alembic)\/|schema\.prisma$/i },
  { name: 'infrastructure', pattern: /(^|\/)(terraform|k8s|kubernetes|helm)\/|\.tf$/i },
]

// The fallback: task words, strongest first.
const SMALL = /\b(rename|typos?|spelling|reformat|format|lint|comments?|docstrings?|wording|readme)\b/
const TASK = [
  { level: 'max', pattern: /\b(security (audit|review)|vulnerabilit(y|ies)|pen ?test|exploit)/, why: 'a security hunt Claude works through on its own' },
  { level: 'xhigh', pattern: /\b(architect\w*|redesign|rewrite|re-?architect\w*|across the (codebase|repo|project|app)|(whole|entire) (codebase|repo|project|app)|performance|optimi[sz]e|concurren\w*|race condition|deadlock|memory leak)/, why: 'a big or deep change across the code' },
  { level: 'high', pattern: /\b(bugs?|fix\w*|broken|errors?|failing|fails|crash\w*|debug\w*|refactor\w*|migrat\w*|upgrade|tests?|edge cases?|regression|investigate|why (does|is|do))\b/, why: 'a fix or change where checking the result matters' },
  { level: 'medium', pattern: /\b(add|build|create|implement|make|feature|page|endpoint|component|integrat\w*|update|write|set ?up)\b/, why: 'new work with a clear scope' },
  { level: 'low', pattern: /\b(explain|what is|what's|how do|brainstorm|ideas?|sketch|summari[sz]e|list|quick)\b/, why: 'a quick question or first sketch you will review' },
]

// Rates one task from its words alone. A scoped task that names payments or
// auth moves up a level, because checking matters more there.
export function rateTask(text) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return null
  let level = 'medium'
  let why = 'no strong signal, so the everyday default'
  const big = TASK.slice(0, 2).find((rule) => rule.pattern.test(t))
  if (!big && SMALL.test(t)) {
    level = 'low'
    why = 'a small edit like a rename or a typo'
  } else {
    const hit = TASK.find((rule) => rule.pattern.test(t))
    if (hit) {
      level = hit.level
      why = hit.why
    }
  }
  const touched = RISKS.filter((r) => r.pattern.test(t.replace(/\s+/g, '-'))).map((r) => r.name)
  if (level === 'medium' && touched.length > 0) {
    level = 'high'
    why = `a change that touches ${list(touched)}`
  }
  return { level, why }
}

// How the running level compares with the recommendation.
export function compare(recommended, running) {
  const r = LEVELS.indexOf(recommended)
  const n = LEVELS.indexOf(running)
  if (r < 0 || n < 0) return 'unknown'
  if (r === n) return 'match'
  return n > r ? 'above' : 'below'
}

function list(items) {
  if (items.length < 2) return items.join('')
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}
