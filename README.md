# effortlevelmod

<img src="plugins/effortlevelmod/.claude-plugin/icon.png" width="72" align="right" alt="">

A Claude Code mod that tells you which effort level fits your project and the task you just gave Claude, right above the prompt, and compares it with the level you're running.

```text
 ◆ Effort  project high  ·  this task low  ·  running high → /effort low saves tokens
```

Running too high burns tokens and time on simple work. Running too low on a tricky bug means more back-and-forth. effortlevelmod reads your project and your prompt and suggests the level that fits, so you don't have to guess.

It only advises. It never changes your effort level itself, because changing effort mid-session can cost you the prompt cache. When you agree, you switch with `/effort <level>`.

## Install

You need Claude Code 2.1.287 or later, where mods load by default. Check with `claude --version`.

In your terminal:

```bash
claude plugin install effortlevelmod --marketplace ydarwish1/effortlevelmod
```

Or inside a Claude Code session:

```text
/plugin install effortlevelmod --marketplace ydarwish1/effortlevelmod
```

Then start a new session. The line above the prompt appears once you're in a project.

Prefer two steps, or an older Claude Code that doesn't know `--marketplace`?

```bash
claude plugin marketplace add ydarwish1/effortlevelmod
claude plugin install effortlevelmod@amel-solutions
```

**Using an AI agent to set it up?** Point it at [AGENTS.md](AGENTS.md). It has the exact steps and checks.

## Use it

| What | What you get |
|---|---|
| The line above the prompt | The project's level, this task's level, the level you're running, and a `/effort` tip when they differ |
| `/effortlevel` | The full report: why your project got its level, your last task, what you're running, and when each level fits |
| `/effortlevel <task>` | A rating for a task before you send it, like `/effortlevel add stripe checkout` |

## How it picks a level

The meaning of each level follows Claude Code's own effort docs ([Choose an effort level](https://code.claude.com/docs/en/model-config#choose-an-effort-level)):

| Level | When it fits |
|---|---|
| `low` | Quick exchanges you review: a rename, a typo, a first sketch, brainstorming |
| `medium` | Day-to-day work with a clear scope, like a new feature. The default on Opus 5.5 |
| `high` | Work where checking matters: fixing a bug in existing code, tests, migrations |
| `xhigh` | Deeper reasoning: architecture, big refactors, performance, concurrency |
| `max` | Hard problems Claude works through alone, like a security audit. Test first: it can overthink |

How a project or a task maps to a level is this mod's own rule of thumb:

- **Your project.** It reads the file list (`git ls-files`, or `find` outside git). A small project (under 15 files, nothing risky) starts at `low`. A project with payments, auth, database migrations or infrastructure code (Terraform, Kubernetes, Helm), or with 300 files or more, starts at `high`. Everything else starts at `medium`.
- **Your task.** Words in the prompt set the level, strongest first. "Security audit" or "vulnerabilities" gives `max`. "Redesign", "performance" or "across the codebase" gives `xhigh`. "Fix", "bug", "refactor", "migrate" or "tests" gives `high`. "Add", "build" or "create" gives `medium`. "Rename", "typo" or "explain" gives `low`.
- **Together.** A `medium` task moves up to `high` when it touches payments or auth, or when the project has risky code.

The rules live in [`plugins/effortlevelmod/hooks/rules.mjs`](plugins/effortlevelmod/hooks/rules.mjs). Change them to fit how you work.

## Update and remove

```bash
claude plugin marketplace update amel-solutions
claude plugin update effortlevelmod@amel-solutions
claude plugin uninstall effortlevelmod@amel-solutions
```

To switch it off without removing it, run `/plugin`, open the **Installed** tab and turn it off.

## Limits

- It reads words and file names, not meaning. "Fix the typo" is `low`, but "fix the login" is `high`. Unusual wording can land a level off. You know the job better.
- The project scan reads at most 50,000 file paths, and skips `node_modules`, `vendor`, `dist`, `build` and virtual environments.
- The running level shows after your first prompt, because Claude Code reports it per request.
- On Windows outside a git repository there's no `find`, so the project starts at `medium`.
- Mods don't load with `--bare` or `--safe-mode`, with `disableAllHooks` set, in a workspace you haven't trusted, or when your organization blocks them.

## How it's built

One hooks module and one file of plain rules, with no dependencies:

```text
.claude-plugin/marketplace.json     the marketplace (amel-solutions)
plugins/effortlevelmod/
  .claude-plugin/plugin.json        the plugin manifest
  hooks/hooks.json                  points Claude Code at the hooks module
  hooks/effortlevelmod.mjs          the hooks: session.start, prompt.submit, turn.step, the band, /effortlevel
  hooks/rules.mjs                   the rules, as plain functions
  tests/effortlevelmod.test.ts      7 tests for claude plugin test
```

| Hook | What it does |
|---|---|
| `session.start` | Adds `/effortlevel`, then reads the project's file list and sets a baseline |
| `prompt.submit` | Rates the prompt. It passes the prompt on unchanged |
| `turn.step` | Notes the effort level each main-loop request runs at. It never changes it |
| `ui.render` on `AbovePrompt` | Draws the line above the prompt, and keeps what other mods draw there |
| `command.run` for `effortlevel` | Prints the report, or rates the task typed after the command |

Checked on Claude Code 2.1.308:

- `claude plugin validate` passes for the marketplace and the plugin.
- `claude plugin test` passes 7 of 7 tests: the rules, the band, `/effortlevel`, the fallback outside git, the narrow band, and that prompts go through unchanged.
- TypeScript (`tsc --checkJs`) passes against Claude Code's mod type definitions.
- A real install from the marketplace, then `/effortlevel` in a real project, works.

To work on it:

```bash
git clone https://github.com/ydarwish1/effortlevelmod.git
cd effortlevelmod
claude plugin validate .
claude plugin validate plugins/effortlevelmod
(cd plugins/effortlevelmod && claude plugin test)
claude --plugin-dir ./plugins/effortlevelmod
```

## License

MIT. See [LICENSE](LICENSE).

Made by Amel Solutions. Not an official Anthropic product.
