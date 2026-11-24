import type { EngineInterface, Register } from 'claude-code'
import { label, stateDir, untilChange, windowSeconds } from './label'

// A status line entry and nothing else: how long the computer stays awake. It reads the times of
// two files the hook and the keeper write: when the line would change (the next minute down, the
// end of the hold), at least every 30 seconds for activity from other sessions, and a second after
// each prompt (once the hook has marked it). It starts no process and reads no event.
const TICK_MS = 30_000
const AFTER_PROMPT_MS = 1_000

export const register: Register = on => {
  let show: (() => Promise<number>) | undefined

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
    show = async () => {
      const [now, activity, failed] = await Promise.all([
        $.clock.now(),
        timeOf($, `${dir}/activity`),
        timeOf($, `${dir}/failed`),
      ])
      $.ui.status(label({ now, activity, failed, window }))
      return Math.min(TICK_MS, untilChange({ now, activity, window }) ?? TICK_MS)
    }
    const loop = async () => {
      const wait = (await show?.()) ?? TICK_MS
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
}

function timeOf($: EngineInterface, path: string): Promise<number | undefined> {
  return $.fs.stat(path).then(
    stat => stat.mtimeMs,
    () => undefined,
  )
}
