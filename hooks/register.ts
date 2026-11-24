import type { EngineInterface, Register } from 'claude-code'
import { label, stateDir, untilChange, windowSeconds } from './label'

// Two things, both read-only for the person's system but one file of our own:
//
// The pulse. While this session works where no hook event fires (a model turn, a tool call that
// runs long, background work it waits on after answering), it marks the activity once a minute, as
// the hook does on each event; the keeper then holds on. It writes only `activity`, and only into
// the folder the hook made. The session's end stops it, and the hold runs out by itself.
//
// The status line: the minutes left, or what the hold waits on. Read when the line would change,
// at least every 30 seconds, and a second after each prompt. No process is started.
const TICK_MS = 30_000
const PULSE_MS = 60_000
const AFTER_PROMPT_MS = 1_000

export const register: Register = on => {
  let show: (() => Promise<void>) | undefined
  const turns = new Set<string>()
  let calls = 0
  let tasks = 0
  const busy = () => turns.size > 0 || calls > 0 || tasks > 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (/^(0|off|false|no)$/i.test((await $.env.get('AWAKE'))?.trim() ?? '')) return result
    const dir = stateDir({
      AWAKE_DIR: await $.env.get('AWAKE_DIR'),
      XDG_RUNTIME_DIR: await $.env.get('XDG_RUNTIME_DIR'),
      TMPDIR: await $.env.get('TMPDIR'),
      USER: await $.env.get('USER'),
    })
    if (!dir) return result
    const window = windowSeconds(await $.env.get('AWAKE_SECONDS'))
    let pulsed = -Infinity
    let wait = TICK_MS
    show = async () => {
      let now = await $.clock.now()
      if (busy() && now - pulsed >= PULSE_MS && (await isFolder($, dir))) {
        await $.fs.write(`${dir}/activity`, '')
        pulsed = now = await $.clock.now()
      }
      const [activity, failed] = await Promise.all([
        timeOf($, `${dir}/activity`),
        timeOf($, `${dir}/failed`),
      ])
      $.ui.status(label({ now, activity, failed, window, tasks }))
      const change = untilChange({ now, activity, window }) ?? TICK_MS
      wait = Math.min(TICK_MS, change)
    }
    const loop = async () => {
      await show?.()
      $.clock.after(wait, () => void loop())
    }
    await loop()
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (show) $.clock.after(AFTER_PROMPT_MS, () => void show?.())
    return result
  })

  // Every turn, the main loop's and each subagent's, is heard from its start to its end.
  on('turn.start', ($, e, next) => {
    turns.add(e.turnId)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    turns.delete(e.turnId)
    return next(e)
  })

  // A call is in flight from its start to its result, however it ends (an interrupt included).
  on('tool.call', async ($, e, next) => {
    calls++
    try {
      return await next(e)
    } finally {
      calls--
    }
  })

  // At each answer the session says what it still waits on; the next answer says it again.
  on('classic.Stop', async ($, e, next) => {
    tasks = e.background_tasks?.length ?? 0
    const result = await next(e)
    await show?.()
    return result
  })
}

async function isFolder($: EngineInterface, path: string): Promise<boolean> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  return stat?.kind === 'dir'
}

function timeOf($: EngineInterface, path: string): Promise<number | undefined> {
  return $.fs.stat(path).then(
    stat => stat.mtimeMs,
    () => undefined,
  )
}
