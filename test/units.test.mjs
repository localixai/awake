import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { holder } from '../lib/holder.mjs'
import { claim, DEFAULT_SECONDS, keeper, release, windowSeconds } from '../lib/state.mjs'

test('macOS holds with caffeinate tied to the keeper', () => {
  assert.deepEqual(holder('darwin', 42, {}), ['caffeinate', '-dims', '-w', '42'])
  assert.deepEqual(holder('darwin', 42, { AWAKE_CAFFEINATE_FLAGS: '-ims' }), [
    'caffeinate',
    '-ims',
    '-w',
    '42',
  ])
})

test('Linux holds with systemd-inhibit when it is installed', () => {
  const bin = mkdtempSync(join(tmpdir(), 'awake-bin-'))
  writeFileSync(join(bin, 'systemd-inhibit'), '')
  chmodSync(join(bin, 'systemd-inhibit'), 0o755)
  const argv = holder('linux', 42, { PATH: bin })
  assert.equal(argv[0], 'systemd-inhibit')
  assert.ok(argv.includes('--what=idle:sleep'))
  assert.deepEqual(argv.slice(-4), ['tail', '--pid=42', '-f', '/dev/null'])
  assert.equal(holder('linux', 42, { PATH: '/nonexistent' }), null)
  assert.equal(holder('win32', 42, {}), null)
})

test('the window is AWAKE_SECONDS when it is a positive whole number', () => {
  assert.equal(windowSeconds({}), DEFAULT_SECONDS)
  assert.equal(windowSeconds({ AWAKE_SECONDS: '60' }), 60)
  for (const value of ['0', '-5', '1.5', 'soon']) {
    assert.equal(windowSeconds({ AWAKE_SECONDS: value }), DEFAULT_SECONDS)
  }
})

test('one keeper at a time; a gone one is replaced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awake-state-'))
  assert.equal(await claim(dir), process.pid)
  assert.equal(keeper(dir), process.pid)
  writeFileSync(join(dir, 'keeper.pid'), `${process.ppid}\n`)
  assert.equal(await claim(dir, () => 1), null, 'a live keeper keeps its place')
  writeFileSync(join(dir, 'keeper.pid'), '999999999\n')
  assert.equal(keeper(dir), null)
  assert.equal(await claim(dir), process.pid)
  release(dir)
  assert.equal(keeper(dir), null)
})
