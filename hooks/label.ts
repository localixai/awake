// What the status line says, from the shared folder's two files and this session's background work:
// nothing while no agent has worked within the window; the minutes left, rounded up, while the
// computer is held (`14m`, and `1m` in the last one); `waiting: 1 task` while the session holds it
// for background work, so a forgotten server is seen; `not held` when the system refused the hold
// (`awake status` says why). The engine puts `awake:` before it.

export const DEFAULT_SECONDS = 900

/** The shared folder, named as `bin/awake` names it; `undefined` when it cannot be told. */
export function stateDir(env: {
  AWAKE_DIR?: string
  XDG_RUNTIME_DIR?: string
  TMPDIR?: string
  USER?: string
}): string | undefined {
  if (env.AWAKE_DIR) return env.AWAKE_DIR
  if (!env.USER) return undefined
  return `${env.XDG_RUNTIME_DIR || env.TMPDIR || '/tmp'}/localix-awake-${env.USER}`
}

/** `AWAKE_SECONDS` when it is a positive whole number, else the default. */
export function windowSeconds(value: string | undefined): number {
  const text = value?.trim() ?? ''
  return /^[1-9]\d*$/.test(text) ? Number(text) : DEFAULT_SECONDS
}

/**
 * @param now milliseconds since the epoch
 * @param activity the time of the last sign of work, if any
 * @param failed the time the last hold was refused, if it was
 * @param tasks this session's background work in flight at its last answer
 */
export function label(input: {
  now: number
  activity?: number
  failed?: number
  window: number
  tasks?: number
}): string | undefined {
  const left = (input.activity ?? 0) + input.window * 1000 - input.now
  if (left <= 0) return undefined
  if (input.failed !== undefined) return 'not held'
  const tasks = input.tasks ?? 0
  if (tasks > 0) return `waiting: ${tasks} ${tasks === 1 ? 'task' : 'tasks'}`
  return `${Math.ceil(left / 60_000)}m`
}

/**
 * Milliseconds until `label` would say something else: the next whole minute down, or the end of
 * the hold. `undefined` while nothing is held (the next sign of work is not on any clock).
 */
export function untilChange(input: {
  now: number
  activity?: number
  window: number
}): number | undefined {
  const left = (input.activity ?? 0) + input.window * 1000 - input.now
  return left > 0 ? ((left - 1) % 60_000) + 1 : undefined
}
