<h1 align="center">awake</h1>

<p align="center">
  <strong>Your computer stays awake while the agent works</strong>
  <br>
  Fifteen minutes after the agent goes quiet, your usual sleep settings take over again.
</p>

<p align="center">
  <a href="https://github.com/localixai/awake/actions/workflows/ci.yml"><img src="https://github.com/localixai/awake/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/github/v/tag/localixai/awake?label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

You start a long task, walk away, and the laptop goes to sleep halfway through the build. I used to
run `caffeinate -dims -t 20000` in a spare terminal before such tasks and then forget to stop it.
awake starts and stops the hold itself, going by what the agent does.

## Install

In Claude Code:

```bash
claude plugin marketplace add localixai/awake
claude plugin install awake@awake
```

The same folder is also an [Agent Plugins](https://agent-plugins.org) package (`plugin.json` and
`hooks.json` at the root), so a client of the core loads it as it is.

It runs on macOS and Linux and needs `node` 20 or later on the `PATH` the agent's hooks see. On
Linux it holds through `systemd-inhibit`, which works from a desktop session.

## What it does

Every prompt, tool call, tool result, subagent, compaction and answer counts as work. The computer
stays awake until 15 minutes after the last one, then the hold ends and the system's own sleep
settings apply again. The plugin reads nothing in the event and sends nothing back to the agent.

All your agents share one hold, so ten sessions in three clients start one background process. On
each tool call the hook runs a short shell script that updates a file's time.

## How it holds

One small process per user, the keeper, holds the computer awake while it runs:

| System | Hold |
| --- | --- |
| macOS | `caffeinate -dims -w <keeper>` |
| Linux | `systemd-inhibit --what=idle:sleep`, around a wait for the keeper |

The keeper sleeps on one timer until 15 minutes after the last activity. When it wakes, it checks
the time again. If the agent did something meanwhile, it sleeps until the new end; if not, it exits
and the hold ends with it. A killed keeper takes its hold along, and the next tool call starts a
new one.

## Is it holding now?

```bash
awake status
```

Claude Code puts the plugin's `bin/` on the `PATH` of its shell, so the agent can run it too. The
answer is the keeper's process id and how long the computer stays awake. When nothing holds it, the
answer says why: no agent worked in the last 15 minutes, `node` was not found, or the system
refused the hold (`systemd-inhibit` outside a desktop session says `Access denied`). After a refusal
the plugin tries again ten minutes later rather than on every tool call. macOS shows the hold in `pmset -g assertions`, Linux in
`systemd-inhibit --list`.

## Settings

Environment variables, in your shell or under `env` in Claude Code's `settings.json`:

| Variable | Default | |
| --- | --- | --- |
| `AWAKE_SECONDS` | `900` | how long the computer stays awake after the last activity |
| `AWAKE` | on | `off` turns it off |
| `AWAKE_CAFFEINATE_FLAGS` | `-dims` | macOS: what `caffeinate` holds; `-ims` lets the display sleep |
| `AWAKE_INHIBIT_WHAT` | `idle:sleep` | Linux: what `systemd-inhibit` holds |
| `AWAKE_DIR` | `localix-awake-<user>` in `$XDG_RUNTIME_DIR` or the temp folder | the shared state and `awake.log` |

## Limits

- A background job that runs longer than the window while the agent says nothing, such as a build
  started with `run_in_background` after the agent already answered, can see the computer fall
  asleep. Raise `AWAKE_SECONDS` for that kind of work.
- Windows is not supported yet: the hook is a POSIX shell script.

## License

MIT
