# Installing effortlevelmod: a guide for AI agents

This file is for an AI agent (Claude Code, Codex, Cursor or similar) that a person has asked to install effortlevelmod. Follow the steps in order. Each step says how to check it worked. Tell the person what you did at the end.

effortlevelmod is a Claude Code mod: a plugin with a hooks module. It shows which effort level fits the project and the current task above the Claude Code prompt, and adds an `/effortlevel` command. It only advises: it never changes the effort level.

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

Then run the mod's command once from inside the person's project folder. It answers without calling a model:

```bash
cd <the person's project>
claude -p "/effortlevel"
```

**Check:** the output starts with `effortlevelmod: This project suits` followed by a level, then the reasons. In a folder the person hasn't trusted yet, mods don't load: open `claude` there once and accept the trust prompt, then run it again.

## Step 4: tell the person

Tell them:

1. It's installed, and which level it gave their project, from Step 3's output.
2. Start a new Claude Code session. The line above the prompt reads like `◆ Effort  project high · this task low · running high → /effort low saves tokens`.
3. `/effortlevel` explains the level. `/effortlevel <task>` rates a task before they send it.
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
| The project level looks wrong | Run `/effortlevel` to see the reasons. The rules read file names and prompt words. They live in `plugins/effortlevelmod/hooks/rules.mjs` if the person wants to change them. |

## For agents working on this repository

- Validate both levels: `claude plugin validate .` and `claude plugin validate plugins/effortlevelmod`.
- Run the tests: `cd plugins/effortlevelmod && claude plugin test`. All must pass before a change is done.
- Try it live: `claude --plugin-dir ./plugins/effortlevelmod`. The mod hot-reloads when its files change.
- Keep `hooks/rules.mjs` free of mods API calls, so the rules stay plain functions that tests import directly.
- In `hooks/effortlevelmod.mjs`, write every mods API call in full (`$.session.cwd()`, never `const s = $.session`), because Claude Code finds hooks and calls by reading the source.
- Bump `version` in `plugins/effortlevelmod/.claude-plugin/plugin.json` and add a line to `CHANGELOG.md` for each release, because installed copies are cached by version.
- The mod's events and methods are documented at https://code.claude.com/docs/en/plugins/mods/reference.
