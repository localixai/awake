// The real holder on macOS, where it needs no session or permission: CI's macOS runner runs it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const AWAKE = new URL('../bin/awake', import.meta.url).pathname
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assertions = () => spawnSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' }).stdout

test(
  'caffeinate holds while the keeper runs, and lets go after',
  { skip: process.platform !== 'darwin' },
  async () => {
    const env = {
      ...process.env,
      AWAKE_DIR: mkdtempSync(join(tmpdir(), 'awake-')),
      AWAKE_SECONDS: '2',
    }
    spawnSync(AWAKE, ['hook'], { input: '{}', env })
    await sleep(1000)
    assert.match(
      spawnSync(AWAKE, ['status'], { env, encoding: 'utf8' }).stdout,
      /^Awake: held by keeper/,
    )
    assert.match(assertions(), /caffeinate/)
    await sleep(3000)
    assert.doesNotMatch(assertions(), /caffeinate command-line tool/)
  },
)
