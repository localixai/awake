# Changelog

## 0.2.0

- **The status line shows how long the computer stays awake** in Claude Code: `awake: 14m` while it
  is held, `awake: not held` when the system refused the hold, and nothing once no agent has worked
  for the window. It reads two files' times when the label would change (the next minute down, the
  end of the hold), at least every 30 seconds, and a second after each prompt; it starts no
  process. `AWAKE=off` hides it too.

## 0.1.0

- **The computer stays awake while an agent works.** Every prompt, tool call, subagent, compaction
  and answer marks the activity. One keeper process per user holds the computer awake
  (`caffeinate -dims` on macOS, `systemd-inhibit` on Linux) and ends 15 minutes after the last
  activity, taking the hold with it. `AWAKE_SECONDS` sets the window, `AWAKE=off` turns it off.
- **One hold for every agent.** Sessions, clients and parallel tool calls share the one keeper. The
  hook is a short shell script: it marks the activity and starts a keeper only when none runs.
- **Claude Code and the Agent Plugins core.** The plugin carries both manifests and both hook
  files, so the same folder loads in Claude Code and in any client of the core.
- **`awake status`** says whether the computer is held awake and, when it is not, why.
