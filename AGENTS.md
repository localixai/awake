# awake

A plugin from Localix Lab that keeps the computer awake while an agent works and lets it sleep once
the agent goes quiet. It loads in Claude Code and in any client of the Agent Plugins core. GitHub
`localixai/awake`.

## How it works

Every hook event that means work runs `bin/awake hook`. The hook touches `activity` in the user's
state folder and, only when no keeper is alive, runs `lib/keeper.mjs launch`. The keeper, one
process per user, starts the system's holder tied to its own process id and sleeps on one timer
until the last activity plus the window. When the timer fires it reads the activity's time again:
newer means sleep again, older means end, and the holder ends with it.

## Layout

| Path | What it is |
| --- | --- |
| `.claude-plugin/` | `plugin.json` (the Claude Code manifest), `marketplace.json` (this repo is its own marketplace) |
| `plugin.json`, `hooks.json` | The Agent Plugins core manifest and hooks: the same plugin for a core client |
| `hooks/hooks.json` | Claude Code's hooks: the events that mean work, each running `bin/awake hook`, and the hooks module |
| `hooks/register.ts`, `hooks/label.ts` | The hooks module: the pulse (marks the activity once a minute while a turn, a tool call or background work lasts) and Claude Code's status line entry (`awake: 14m`, `awake: waiting: 1 task`) |
| `bin/awake` | The hook and `awake status`. POSIX `sh`, the hot path: no Node on a call that finds the keeper alive |
| `lib/keeper.mjs` | The keeper: `launch`, `run`, `status` |
| `lib/holder.mjs` | The system's keep-awake program per platform, tied to the keeper's process |
| `lib/state.mjs` | The shared folder: the activity, `keeper.pid` and its claim lock, the failure, the log |
| `test/` | Node tests (`npm test`): the units, the hook and keeper end to end, the real holder on macOS |
| `tests/` | The hooks module's tests (`npm run test:mod`, through `claude plugin test`) |

## Commands

| Command | |
| --- | --- |
| `npm test` | Every test. The end-to-end ones put a stand-in holder on `PATH`; `real.test.mjs` runs `caffeinate` on macOS. CI runs Linux and macOS on Node 20 and 22. |
| `npm run test:mod` | The hooks module: the label and the status line on a mocked clock and folder. Needs `claude`. |
| `npm run validate` | `claude plugin validate . --strict`: the manifests, and the module and `tests/` type-checked against the running Claude Code's types |
| `claude --plugin-dir .` | The working tree in a real session. `bin/awake status` shows what it holds. |

## Rules

- **The hook stays cheap.** It runs on every tool call of every agent: a shell, `cat` and `touch`
  when the keeper is alive. Nothing that starts Node, parses the event or forks more processes goes
  into its common path.
- **One keeper, never a second.** `keeper.pid` is written only under `claim.lock`; a change to how a
  keeper starts or ends keeps the order that makes the end safe: release, then read the activity
  again (`lib/keeper.mjs`).
- **The holder ends with the keeper.** It is tied to the keeper's process id (`caffeinate -w`,
  `tail --pid`), so a crash or a kill takes the hold along. A new platform's holder does the same.
- **The pulse changes nothing of the person's.** It writes `activity` alone, only into a folder the
  hook made, starts no process and ends with the session. What it counts as work is a turn, a tool
  call and `background_tasks` at `Stop`; waiting for a person and scheduled wakeups are not work.
- **The status line stays minimal.** One short entry, no pane, no process: the module reads file
  times only, and names the folder exactly as `bin/awake` does (`hooks/label.ts`, `stateDir`).
- **Nothing reaches the agent.** The hook prints nothing and exits 0 whatever happens; failures go
  to `failed` and `awake.log` in the state folder and show in `awake status`.
- **Both forms stay equivalent.** An event added to `hooks/hooks.json` that the core also defines is
  added to `hooks.json`; the two manifests carry the same name, version and description.
- **A change raises `version`** in both manifests and `package.json`, with its `CHANGELOG.md` entry.
- English only. Commit only when asked; never push unasked.
