import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const MIN = 60_000
const START = 1_800_000_000_000
const DIR = '/state'
const START_INPUT = { cwd: '/project', surface: 'terminal', isInteractive: true } as const
const TASK = { id: 'b1', type: 'shell', status: 'running', description: 'npm run build' }

/**
 * The shared folder as a test answers it: the hook made it and marked the activity at the start;
 * each write the module makes is kept, with the mocked clock's time.
 */
function world(on: On, options: { folder?: boolean; env?: Record<string, string> } = {}) {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { AWAKE_DIR: DIR, ...options.env })
  const files: Record<string, number> = { activity: START }
  const writes: string[] = []
  on('fs.stat', (_, e) => {
    if (e.path === DIR && options.folder !== false) {
      return { value: { kind: 'dir', size: 0, mtimeMs: START, isLink: false } }
    }
    const mtimeMs = e.path.startsWith(`${DIR}/`) ? files[e.path.slice(DIR.length + 1)] : undefined
    if (mtimeMs === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file', size: 0, mtimeMs, isLink: false } }
  })
  on('fs.write', (_, e) => {
    writes.push(e.path)
    files[e.path.slice(DIR.length + 1)] = clock.now()
    return { value: undefined }
  })
  const shown: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  return { clock, writes, shown }
}

const stop = (tasks: (typeof TASK)[]) => ({
  session_id: 's',
  transcript_path: '/t',
  cwd: '/project',
  hook_event_name: 'Stop',
  stop_hook_active: false,
  background_tasks: tasks,
}) as const

test('background work after an answer keeps the activity marked', async ($, on) => {
  const w = world(on)
  await $.session.start(START_INPUT)
  await $.classic.Stop(stop([TASK]))
  expect(w.shown.at(-1)).toBe('waiting: 1 task')

  await w.clock.advance(20 * MIN)
  expect(w.writes.length).toBeGreaterThanOrEqual(19)
  expect(new Set(w.writes)).toEqual(new Set([`${DIR}/activity`]))
  expect(w.shown.at(-1)).toBe('waiting: 1 task')

  await $.classic.Stop(stop([]))
  const marked = w.writes.length
  await w.clock.advance(14 * MIN)
  expect(w.shown.at(-1)).toBe('1m')
  await w.clock.advance(2 * MIN)
  expect(w.writes.length).toBe(marked)
  expect(w.shown.at(-1)).toBeUndefined()
})

test('a turn keeps the activity marked from its start to its end', async ($, on) => {
  const w = world(on)
  await $.session.start(START_INPUT)
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await w.clock.advance(30 * MIN)
  expect(w.shown.at(-1)).toBe('15m')
  expect(w.writes.length).toBeGreaterThanOrEqual(29)
})

test('nothing is written where the hook made no folder, or with AWAKE=off', async ($, on) => {
  const w = world(on, { folder: false })
  await $.session.start(START_INPUT)
  await $.classic.Stop(stop([TASK]))
  await w.clock.advance(5 * MIN)
  expect(w.writes).toEqual([])
})

test('AWAKE=off neither marks nor shows', async ($, on) => {
  const w = world(on, { env: { AWAKE: 'off' } })
  await $.session.start(START_INPUT)
  await $.classic.Stop(stop([TASK]))
  await w.clock.advance(5 * MIN)
  expect(w.writes).toEqual([])
  expect(w.shown).toEqual([])
})
