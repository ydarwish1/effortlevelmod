# Installing effortlevelmod: a guide for AI agents

This file is for an AI agent (Claude Code, Codex, Cursor or similar) that a person has asked to install effortlevelmod. Follow the steps in order. Each step says how to check it worked. Tell the person what you did at the end.

effortlevelmod is a Claude Code mod: a plugin with a hooks module. It rates each task the person sends with a small, fast model (Haiku), and shows the effort level that fits and a short reason above the Claude Code prompt. It also adds an `/effortlevel` command, and an Ultrathink button (and `/ultra`) that runs the next message, or the rest of the current turn, at xhigh effort when the person presses it. On its own it never changes the effort level.

- Repository: `https://github.com/ydarwish1/effortlevelmod`
- Marketplace name: `amel-solutions`
- Plugin name: `effortlevelmod`
- Install id: `effortlevelmod@amel-solutions`

## Rules for the agent

- Install for the person's user scope unless they ask for a project. Don't change their effort level, settings or `CLAUDE.md`.
- Don't use `sudo`, and don't edit files under `~/.claude` by hand. The `claude plugin` commands do every write.
- If a step fails, stop and report the exact error text with the matching fix from [Troubleshooting](#troubleshooting). Don't improvise workarounds.

## Step 1: check Claude Code

```bash
claude --version
```

The version must be **2.1.287 or later**, where mods load by default. If it's older, ask the person whether to update. They update with `claude update`, or reinstall from https://code.claude.com/docs/en/setup. Don't continue on an older version: the plugin installs, but the mod won't load.

## Step 2: install

Run one command:

```bash
claude plugin install effortlevelmod --marketplace ydarwish1/effortlevelmod
```

If it fails with an unknown option `--marketplace`, use the two-step form:

```bash
claude plugin marketplace add ydarwish1/effortlevelmod
claude plugin install effortlevelmod@amel-solutions
```

For a project-only install that teammates share through the repository's settings, add `--scope project` to the install command, and only when the person asks for that.

**Check:** the output ends with `✔ Successfully installed plugin: effortlevelmod@amel-solutions`.

## Step 3: verify

```bash
claude plugin list
```

**Check:** the list shows `effortlevelmod@amel-solutions` with `Status: ✔ enabled`.

Then rate one task from inside the person's project folder. This makes one small Haiku call:

```bash
cd <the person's project>
claude -p "/effortlevel fix the typo in the README"
```

**Check:** the output starts with `effortlevelmod: "fix the typo in the README" suits low effort.`, then a `why:` line. If a line says `rated by word rules`, the Haiku call failed: see [Troubleshooting](#troubleshooting). In a folder the person hasn't trusted yet, mods don't load: open `claude` there once and accept the trust prompt, then run it again.

## Step 4: tell the person

Tell them:

1. It's installed, and the level and reason Step 3 gave.
2. Start a new Claude Code session. After each message, the line above the prompt reads like `◆ Effort  this task low  ·  running high → /effort low saves tokens`, with the reason on the line below it.
3. `/effortlevel` shows the last rating and when each level fits. `/effortlevel <task>` rates a task before they send it.
4. The ⚡ Ultrathink button under the line (or `/ultra`) runs their next message at xhigh effort; pressed while Claude works, it raises the rest of that turn.
4. It only suggests. They switch with `/effort <level>`.

## Update or remove

```bash
claude plugin marketplace update amel-solutions
claude plugin update effortlevelmod@amel-solutions
claude plugin uninstall effortlevelmod@amel-solutions
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `unknown option '--marketplace'` | Older Claude Code. Use the two-step form in Step 2, then update Claude Code (Step 1). |
| `Plugin "effortlevelmod" not found` | The marketplace isn't added, or it's stale. Run `claude plugin marketplace add ydarwish1/effortlevelmod`, or `claude plugin marketplace update amel-solutions`. |
| A clone or auth error on `marketplace add` | GitHub isn't reachable or git isn't installed. Check `git --version` and the network, then retry. |
| Installed, but `/effortlevel` is an unknown command | The mod didn't load. Check the version (2.1.287+), that the session isn't started with `--bare` or `--safe-mode`, that `disableAllHooks` isn't set in settings, and that the folder is trusted. Run `claude --debug` and look for lines that name `effortlevelmod`. |
| `hooks modules are turned off` | The person's organization blocks user-installed mods through managed settings. Stop and tell the person. Don't try to get around it. |
| The reason starts with `word rules:` | The Haiku call failed (no network, Haiku blocked by the organization's model allowlist, or an API error), so the backup word rules rated the task. Check that `claude -p "say hi" --model haiku` answers. |
| A rating looks wrong | Run `/effortlevel` to see the reason. Haiku rates each task with the brief `RATER` in `plugins/effortlevelmod/hooks/rules.mjs`, which the person can change. |

## For agents working on this repository

- Validate both levels: `claude plugin validate .` and `claude plugin validate plugins/effortlevelmod`.
- Run the tests: `cd plugins/effortlevelmod && claude plugin test`. All must pass before a change is done.
- Try it live: `claude --plugin-dir ./plugins/effortlevelmod`. The mod hot-reloads when its files change.
- Keep `hooks/rules.mjs` free of mods API calls, so the rules stay plain functions that tests import directly.
- In `hooks/effortlevelmod.mjs`, write every mods API call in full (`$.model.complete(...)`, never `const m = $.model`), because Claude Code finds hooks and calls by reading the source.
- A change to `RATER` is a change to every rating. Run it on real tasks before you ship it, with `claude -p "/effortlevel <task>" --plugin-dir ./plugins/effortlevelmod`.
- Bump `version` in `plugins/effortlevelmod/.claude-plugin/plugin.json` and add a line to `CHANGELOG.md` for each release, because installed copies are cached by version.
- The mod's events and methods are documented at https://code.claude.com/docs/en/plugins/mods/reference.
