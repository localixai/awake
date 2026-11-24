// The hook and the keeper end to end, with a stand-in for the system's holder that records each
// start and lives as the real one does, until the keeper ends: on Linux `systemd-inhibit` (the
// real one needs a desktop session), on macOS `caffeinate` (real.test.mjs runs the real one).
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const AWAKE = new URL('../bin/awake', import.meta.url).pathname
const linux = process.platform === 'linux'
const supported = linux || process.platform === 'darwin'
const NAME = linux ? 'systemd-inhibit' : 'caffeinate'
// systemd-inhibit runs its command; caffeinate -w <pid> waits for the keeper itself.
const STAND_IN = linux
  ? 'while [[ "$1" == --* ]]; do shift; done\nexec "$@"\n'
  : 'pid="${@: -1}"\nwhile kill -0 "$pid" 2>/dev/null; do sleep 0.1; done\n'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function world({ seconds = 2, inhibit } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'awake-bin-'))
  const trace = join(bin, 'trace')
  const script = inhibit ?? `#!/bin/bash\necho "$*" >> ${trace}\n${STAND_IN}`
  writeFileSync(join(bin, NAME), script)
  chmodSync(join(bin, NAME), 0o755)
  const dir = mkdtempSync(join(tmpdir(), 'awake-state-'))
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    AWAKE_DIR: dir,
    AWAKE_SECONDS: String(seconds),
  }
  const starts = () => (existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [])
  const pid = () => {
    try {
      return Number(readFileSync(join(dir, 'keeper.pid'), 'utf8'))
    } catch {
      return null
    }
  }
  const status = () => spawnSync(AWAKE, ['status'], { env, encoding: 'utf8' }).stdout.trim()
  // The holder of a keeper, while it runs.
  const holderOf = (keeper) => {
    const pattern = linux ? `tail --pid=${keeper}` : `${bin}/caffeinate`
    return spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).stdout.trim()
  }
  return { dir, env, starts, pid, status, holderOf }
}

function hook(env, input = '{"hook_event_name":"PreToolUse","session_id":"s","cwd":"/"}') {
  const out = spawnSync(AWAKE, ['hook'], { input, env, encoding: 'utf8' })
  assert.equal(out.status, 0)
  assert.equal(out.stdout, '', 'the hook never answers the client')
  return out
}

/** The hook as a client runs many at once: parallel tool calls, several agents. */
function hooks(env, count) {
  return Promise.all(
    Array.from({ length: count }, () => {
      const child = spawn(AWAKE, ['hook'], { env, stdio: ['pipe', 'ignore', 'ignore'] })
      child.stdin.end('{}')
      return new Promise((resolve) => child.once('exit', resolve))
    }),
  )
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('many hooks at once start one keeper and one holder', { skip: !supported }, async () => {
  const w = world({ seconds: 3 })
  await hooks(w.env, 20)
  await sleep(600)
  await hooks(w.env, 20)
  assert.equal(w.starts().length, 1)
  assert.ok(alive(w.pid()))
  assert.match(w.status(), /^Awake: held by keeper \d+, [23]s after the last activity\.$/)
})

test(
  'activity keeps the keeper; quiet ends it and the hold with it',
  { skip: !supported },
  async () => {
    const w = world({ seconds: 2 })
    hook(w.env)
    await sleep(500)
    const keeper = w.pid()
    assert.ok(alive(keeper))
    await sleep(1000)
    hook(w.env)
    await sleep(1200)
    assert.ok(alive(keeper), 'a sign of work 1.5 s in moved the end')
    await sleep(1800)
    assert.ok(!alive(keeper), 'two quiet seconds ended it')
    assert.equal(w.pid(), null)
    assert.equal(w.holderOf(keeper), '', 'the holder ended with it')
    assert.match(w.status(), /^Not held: no agent has worked recently\.$/)
    hook(w.env)
    await sleep(500)
    assert.equal(w.starts().length, 2, 'the next sign of work starts a new keeper')
  },
)

test(
  'a killed keeper takes its hold along, and the next hook replaces it',
  { skip: !supported },
  async () => {
    const w = world({ seconds: 30 })
    hook(w.env)
    await sleep(500)
    const keeper = w.pid()
    process.kill(keeper, 'SIGKILL')
    await sleep(1500)
    assert.equal(w.holderOf(keeper), '')
    hook(w.env)
    await sleep(500)
    assert.notEqual(w.pid(), keeper)
    assert.ok(alive(w.pid()))
    process.kill(w.pid(), 'SIGTERM')
    await sleep(500)
    assert.equal(w.pid(), null, 'a keeper stopped by a signal gives its place up')
  },
)

test(
  'a holder that is refused is recorded and not retried on every event',
  { skip: !supported },
  async () => {
    const refused = '#!/bin/sh\necho "Failed to inhibit: Access denied" >&2\nexit 1\n'
    const w = world({ inhibit: refused })
    hook(w.env)
    await sleep(800)
    const said = new RegExp(
      `^Not held: ${NAME} ended at once \\(exit 1\\): Failed to inhibit: Access denied$`,
    )
    assert.match(w.status(), said)
    const log = () => readFileSync(join(w.dir, 'awake.log'), 'utf8').match(/ended at once/g).length
    assert.equal(log(), 1)
    await hooks(w.env, 5)
    await sleep(800)
    assert.equal(log(), 1)
  },
)

test(
  'AWAKE=off marks nothing; a large event is read to its end',
  { skip: !supported },
  async () => {
    const w = world()
    hook({ ...w.env, AWAKE: 'off' })
    assert.ok(!existsSync(join(w.dir, 'activity')))
    hook(w.env, JSON.stringify({ tool_input: { content: 'x'.repeat(4 << 20) } }))
    await sleep(500)
    assert.ok(alive(w.pid()))
  },
)
