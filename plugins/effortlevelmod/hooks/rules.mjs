// effortlevelmod: the rules, as plain functions with no mods API calls,
// so the tests can check them directly.
//
// The level meanings follow Claude Code's effort docs
// (https://code.claude.com/docs/en/model-config#choose-an-effort-level).
// How a project or a task is mapped to a level is this mod's own rule of
// thumb, not an official setting.

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

// When each level fits, in the docs' words where possible.
export const WHEN = {
  low: 'quick exchanges you review: a rename, a typo, a first sketch, brainstorming',
  medium: 'day-to-day work with a clear scope, like a new feature (the Opus 5.5 default)',
  high: 'work where checking matters: fixing a bug in existing code, tests, migrations',
  xhigh: 'deeper reasoning: architecture, big refactors, performance, concurrency',
  max: 'hard problems Claude works through alone, like a security audit (test first, it can overthink)',
}

// Areas where a wrong change is costly, matched against file paths.
const RISKS = [
  { name: 'payments', pattern: /(^|[\/._-])(payments?|billing|stripe|checkout|invoices?|paypal|subscriptions?)([\/._-]|$)/i },
  { name: 'auth', pattern: /(^|[\/._-])(auth|oauth|login|signin|sessions?|passwords?|jwt)([\/._-]|$)/i },
  { name: 'database migrations', pattern: /(^|\/)(migrations?|alembic)\/|schema\.prisma$/i },
  { name: 'infrastructure', pattern: /(^|\/)(terraform|k8s|kubernetes|helm)\/|\.tf$/i },
]

const TESTS = /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|(^|\/)test_[^\/]+\.py$/i

const LANGS = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift',
  php: 'PHP', cs: 'C#', cpp: 'C++', c: 'C', sql: 'SQL', html: 'HTML', css: 'CSS', vue: 'Vue', svelte: 'Svelte',
}

// Folders that hold other people's code or build output.
const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.next|\.venv|venv|__pycache__|\.git)\//

// Reads a list of file paths and sets the project's baseline level.
export function profileProject(paths) {
  const files = paths.map((p) => p.trim().replace(/^\.\//, '')).filter((p) => p && !SKIP.test(p))
  const counts = {}
  for (const f of files) {
    const lang = LANGS[(f.split('.').pop() || '').toLowerCase()]
    if (lang) counts[lang] = (counts[lang] || 0) + 1
  }
  const langs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3)
  const hasTests = files.some((f) => TESTS.test(f))
  const risks = RISKS.filter((r) => files.some((f) => r.pattern.test(f))).map((r) => r.name)

  let level = 'medium'
  const reasons = []
  if (files.length === 0) {
    reasons.push('no files found yet, so starting at the Opus 5.5 default')
  } else if (files.length < 15 && risks.length === 0) {
    level = 'low'
    reasons.push(`a small project (${files.length} files), good for quick changes you review`)
  } else if (risks.length > 0) {
    level = 'high'
    reasons.push(`it has ${list(risks)} code, where a wrong change is costly`)
  } else if (files.length >= 300) {
    level = 'high'
    reasons.push(`a large codebase (${files.length} files), so changes touch more`)
  } else {
    reasons.push(`a mid-size project (${files.length} files) with no risky areas found`)
  }
  if (hasTests) reasons.push('it has tests, so Claude can check its own work')
  return { files: files.length, langs, hasTests, risks, level, reasons }
}

// Task words, strongest first.
const SMALL = /\b(rename|typos?|spelling|reformat|format|lint|comments?|docstrings?|wording|readme)\b/
const TASK = [
  { level: 'max', pattern: /\b(security (audit|review)|vulnerabilit(y|ies)|pen ?test|exploit)/, reason: 'a security hunt Claude works through on its own' },
  { level: 'xhigh', pattern: /\b(architect\w*|redesign|rewrite|re-?architect\w*|across the (codebase|repo|project|app)|(whole|entire) (codebase|repo|project|app)|performance|optimi[sz]e|concurren\w*|race condition|deadlock|memory leak)/, reason: 'a big or deep change across the code' },
  { level: 'high', pattern: /\b(bugs?|fix\w*|broken|errors?|failing|fails|crash\w*|debug\w*|refactor\w*|migrat\w*|upgrade|tests?|edge cases?|regression|investigate|why (does|is|do))\b/, reason: 'a fix or change where checking the result matters' },
  { level: 'medium', pattern: /\b(add|build|create|implement|make|feature|page|endpoint|component|integrat\w*|update|write|set ?up)\b/, reason: 'new work with a clear scope' },
  { level: 'low', pattern: /\b(explain|what is|what's|how do|brainstorm|ideas?|sketch|summari[sz]e|list|quick)\b/, reason: 'a quick question or first sketch you will review' },
]

// Rates one task. With a project profile, a scoped task in a risky project
// moves up a level, because checking matters more there.
export function rateTask(text, profile) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return null
  let level = 'medium'
  let reason = 'no strong signal, so the everyday default'
  const big = TASK.slice(0, 2).find((rule) => rule.pattern.test(t))
  if (!big && SMALL.test(t)) {
    level = 'low'
    reason = 'a small edit like a rename or a typo'
  } else {
    const hit = TASK.find((rule) => rule.pattern.test(t))
    if (hit) {
      level = hit.level
      reason = hit.reason
    }
  }
  const reasons = [reason]
  const touched = RISKS.filter((r) => r.pattern.test(t.replace(/\s+/g, '-'))).map((r) => r.name)
  if (level === 'medium' && touched.length > 0) {
    level = 'high'
    reasons.push(`it touches ${list(touched)}`)
  } else if (level === 'medium' && profile && profile.risks.length > 0) {
    level = 'high'
    reasons.push(`this project has ${list(profile.risks)} code`)
  }
  return { level, reasons }
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
