# effortlevelmod

<img src="plugins/effortlevelmod/.claude-plugin/icon.png" width="72" align="right" alt="">

A Claude Code mod that tells you which effort level fits the task you just gave Claude, and why, right above the prompt. It compares that with the level you're running.

```text
 ◆ Effort  this task low  ·  running high → /effort low saves tokens
   a one-word typo fix in docs, quick and easy to check
   0: ⚡ Ultrathink next message
```

Running too high burns tokens and time on simple work. Running too low on a tricky bug means more back-and-forth. effortlevelmod has a small, fast model (Haiku) read each message you send and pick the level that fits, so you don't have to guess.

On its own it only advises: it never changes your effort level, and you switch with `/effort <level>` when you agree. The one exception is yours to press: the **Ultrathink** button runs your next message (or, while Claude is working, the rest of that turn) at `xhigh`, the level the `ultrathink` keyword uses, and your `/effort` setting stays as it was.

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

Then start a new session. The line appears above the prompt, and rates each message you send.

Prefer two steps, or an older Claude Code that doesn't know `--marketplace`?

```bash
claude plugin marketplace add ydarwish1/effortlevelmod
claude plugin install effortlevelmod@amel-solutions
```

**Using an AI agent to set it up?** Point it at [AGENTS.md](AGENTS.md). It has the exact steps and checks.

## Use it

| What | What you get |
|---|---|
| The line above the prompt | This task's level and the reason, the level you're running, and a `/effort` tip when they differ |
| `/effortlevel` | The report: your last task's level and reason, what you're running, and when each level fits |
| `/effortlevel <task>` | A rating for a task before you send it, like `/effortlevel add stripe checkout` |
| The **⚡ Ultrathink** button, under the line | Before you send: your next message runs at `xhigh`. While Claude is working: the rest of that turn runs at `xhigh`. Press again to cancel |
| `/ultra` | The same as the button, for places without the line above the prompt, such as the VS Code extension |

## The Ultrathink button

Since Claude Code 2.1.311, typing `ultrathink` in a message runs that turn at `xhigh` effort, in the terminal. The button does the same in one press, in the terminal and in the Desktop app, without changing what you typed:

- **Click it** in the Desktop app, or in the terminal with [fullscreen rendering](https://code.claude.com/docs/en/fullscreen.md). In any terminal, type `0` into an empty prompt and pause, or press Ctrl+X then Tab and Enter. Or type `/ultra`.
- **Before you send**, it arms your next message: the line says `your next message runs at xhigh`. That one message's turn runs at `xhigh`, then everything goes back to your level.
- **While Claude is working**, it raises the rest of the turn, like typing `ultrathink` mid-turn. When Haiku rates the task `xhigh` or `max`, the line points at the button: `← this task needs it`.
- **It never lowers your level.** On `xhigh` or `max` already, it changes nothing. Opus 4.6 and Sonnet 4.6 have no `xhigh`, so they get `high`. A model without effort is left alone, and so are subagents.
- **Your cache.** On Opus 5.5 with an API key or a Claude subscription, changing effort keeps the prompt cache. On Amazon Bedrock, Google Cloud or a Claude apps gateway, a change of effort clears it, so the boosted turn rereads the conversation at the cache-write price ([What a task costs on Opus 5.5](https://claude.dev/blog/what-a-task-costs-on-opus-5-5/)).

## How it picks a level

The meaning of each level follows Claude Code's own effort docs ([Choose an effort level](https://code.claude.com/docs/en/model-config#choose-an-effort-level)):

| Level | When it fits |
|---|---|
| `low` | Quick exchanges you review: a rename, a typo, a first sketch, brainstorming |
| `medium` | Day-to-day work with a clear scope, like a new feature. The default on Opus 5.5 |
| `high` | Work where checking matters: fixing a bug in existing code, tests, migrations |
| `xhigh` | Deeper reasoning: architecture, big refactors, performance, concurrency |
| `max` | Hard problems Claude works through alone, like a security audit. Test first: it can overthink |

How a task maps to a level is this mod's own judgment:

- **Haiku rates each task.** When you send a message, the mod sends it to Haiku with a short brief: the levels above, what pushes a task up (edge cases, verification, risk, an underspecified build Claude must run alone) and what keeps it down ("quick", a question, a small edit). Haiku answers with a level and a reason of about ten words. Your prompt goes on to Claude at once; it never waits for the rating.
- **"Yes, do it" counts.** The brief also gets the end of Claude's last reply, so a short approval is rated as the work it approves.
- **The task, not the project.** A big or risky project does not make a small task bigger. A typo fix in a payments app is still `low`.
- **A backup.** If the Haiku call fails, word rules rate the task instead, and the reason starts with `word rules:`.

The brief (`RATER`) and the word rules live in [`plugins/effortlevelmod/hooks/rules.mjs`](plugins/effortlevelmod/hooks/rules.mjs). Change them to fit how you work.

## Update and remove

```bash
claude plugin marketplace update amel-solutions
claude plugin update effortlevelmod@amel-solutions
claude plugin uninstall effortlevelmod@amel-solutions
```

To switch it off without removing it, run `/plugin`, open the **Installed** tab and turn it off.

## Limits

- Each message you send makes one small Haiku call (about 1,050 tokens in and 40 out). It counts toward your plan or API usage. Slash commands are not rated.
- The rating takes a second or two (1.0 to 1.6 seconds in tests). Until then the line says `rating this task…`.
- Haiku sees your message and the end of Claude's last reply, not your code. A level can land one off. You know the job better.
- The running level shows after your first prompt, because Claude Code reports it per request.
- The line above the prompt, and so the Ultrathink button, draws in the terminal and the Desktop app, not in the VS Code extension: use `/ultra` there. While you've collapsed the line (Ctrl+X then Ctrl+A), its button can't be pressed.
- Mods don't load with `--bare` or `--safe-mode`, with `disableAllHooks` set, in a workspace you haven't trusted, or when your organization blocks them.

## How it's built

One hooks module and one file of plain rules and the rating brief, with no dependencies:

```text
.claude-plugin/marketplace.json     the marketplace (amel-solutions)
plugins/effortlevelmod/
  .claude-plugin/plugin.json        the plugin manifest
  hooks/hooks.json                  points Claude Code at the hooks module
  hooks/effortlevelmod.mjs          the hooks: session.start, prompt.submit, turn.complete, turn.step, the band, /effortlevel, /ultra
  hooks/rules.mjs                   the rating brief, the answer parser and the backup word rules
  tests/effortlevelmod.test.ts      19 tests for claude plugin test
```

| Hook | What it does |
|---|---|
| `session.start` | Adds `/effortlevel` and `/ultra` |
| `prompt.submit` | Starts a Haiku rating of the prompt, in a timer of its own, and hands an armed Ultrathink to this message. It passes the prompt on unchanged |
| `turn.complete` | Keeps the end of Claude's last reply, so "yes, do it" is rated as the work it approves |
| `turn.step` | Notes the effort level each main-loop request runs at. Only for a turn you pressed Ultrathink for, it sends that turn's requests at `xhigh` |
| `ui.render` on `AbovePrompt` | Draws the line above the prompt, and keeps what other mods draw there |
| `command.run` for `effortlevel` | Prints the report, or rates the task typed after the command |
| `command.run` for `ultra` | Presses Ultrathink, and says what it did in a toast |

Version 0.3.0 (the Ultrathink button), checked on Claude Code 2.1.312 and 2.1.308:

- `claude plugin validate` passes for the marketplace and the plugin.
- `claude plugin test` passes 19 of 19 tests. The 7 new ones: the button arms only your next message; a press mid-turn raises the rest of that turn; the button draws and works in the Desktop app; `/ultra` arms and a second press cancels; it never lowers `max`, skips a model without effort, waits past slash commands and gives Opus 4.6 `high`; every main request of a boosted turn runs at `xhigh` while subagents keep their level; an armed boost goes to the next turn, never a late request of an older one.
- `/ultra` and `/effortlevel` run in a real Claude Code session through `claude -p`.
- Not yet tried by hand: pressing the button in a signed-in terminal and in the Desktop app.

Version 0.2.0, checked on Claude Code 2.1.309:

- `claude plugin validate --strict` passes for the marketplace and the plugin.
- `claude plugin test` passes 12 of 12 tests: reading Haiku's answer, the brief, the backup word rules, the band and its reason, the switch tips both ways, the fallback when Haiku fails or answers no level, `/effortlevel`, "yes, do it", slash commands left alone, a slow rating never replacing a newer one, and the narrow band. Eight deliberate breaks of the code each turned at least one test red.
- TypeScript (`tsc --checkJs` with strict null checks) passes against Claude Code's mod type definitions, the Haiku call included.
- Real ratings through `claude -p "/effortlevel <task>"` in a real project: 25 test tasks, run twice, came out 25 and 24 exact and 25 of 25 within range both times. 15 more tasks in looser wording came out 15 of 15 within range. Version 0.1.0 managed 15 of 25 and 7 of 15.
- A real install from the marketplace, then the line above the prompt in a real session, works.

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
