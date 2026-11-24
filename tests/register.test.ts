import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const MIN = 60_000
const START = 1_800_000_000_000
const DIR = '/state'
const START_INPUT = { cwd: '/project', surface: 'terminal', isInteractive: true } as const

/** The shared folder as a test answers it: the files and their times. */
function folder(on: On, files: Record<string, number>) {
  on('fs.stat', (_, e) => {
    const mtimeMs = e.path.startsWith(`${DIR}/`) ? files[e.path.slice(DIR.length + 1)] : undefined
    if (mtimeMs === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file', size: 0, mtimeMs, isLink: false } }
  })
}

function statusLine(on: On) {
  const shown: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return shown
}

test('the status line counts down from the last activity and clears after it', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { AWAKE_DIR: DIR, AWAKE_SECONDS: '600' })
  folder(on, { activity: START })
  const shown = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start(START_INPUT)
  expect(shown.at(-1)).toBe('10m')
  await clock.advance(4 * MIN)
  expect(shown.at(-1)).toBe('6m')
  await clock.advance(5 * MIN + 59_000)
  expect(shown.at(-1)).toBe('1m')
  await clock.advance(1_000)
  expect(shown.at(-1)).toBeUndefined()
})

test('a refused hold is shown as not held', async ($, on) => {
  mock.clock(on, { now: START })
  mock.env(on, { AWAKE_DIR: DIR })
  folder(on, { activity: START, failed: START - MIN })
  const shown = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start(START_INPUT)
  expect(shown).toEqual(['not held'])
})

test('AWAKE=off shows nothing', async ($, on) => {
  mock.clock(on, { now: START })
  mock.env(on, { AWAKE: 'off', AWAKE_DIR: DIR })
  folder(on, { activity: START })
  const shown = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start(START_INPUT)
  expect(shown).toEqual([])
})
