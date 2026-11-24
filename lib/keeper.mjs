// The keeper: the one process of this user that holds the computer awake. It sleeps on a single
// timer until the last sign of work plus the window, reads the activity's time again, and sleeps
// again or ends; the system's holder (lib/holder.mjs) ends with it. Nothing polls: the keeper
// wakes once per window at most, the hook never waits for it.
//
//   node keeper.mjs launch <dir>   start a keeper in the background unless one runs (the hook)
//   node keeper.mjs run <dir>      be the keeper (started by `launch`)
//   node keeper.mjs status <dir>   whether the computer is held awake, and for how long

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { holder } from './holder.mjs'
import {
  claim,
  clearFailure,
  fail,
  failure,
  keeper,
  lastActivity,
  log,
  release,
  windowSeconds,
} from './state.mjs'

/** A holder that ends this soon after its start was refused (no permission, no such program). */
const SETTLE_MS = 300
/** Past the end, so that the timer never fires a moment before it. */
const MARGIN_MS = 250

/** Starts the keeper detached from the hook, in its own session, with no stdio shared. */
export async function launch(dir, env = process.env) {
  if (keeper(dir)) return null
  return claim(dir, () => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', dir], {
      detached: true,
      stdio: 'ignore',
      env,
    })
    child.unref()
    return new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', () => resolve(child.pid))
    })
  })
}

/** Holds the computer awake until the window after the last sign of work has passed. */
export async function run(dir, { env = process.env, platform = process.platform } = {}) {
  const seconds = windowSeconds(env)
  const argv = holder(platform, process.pid, env)
  if (!argv) {
    fail(dir, `no keep-awake program on ${platform}`)
    release(dir)
    return
  }
  let child
  try {
    child = await startHolder(argv, env)
  } catch (error) {
    fail(dir, error.message)
    release(dir)
    return
  }
  clearFailure(dir)

  let done = false
  const stop = () => {
    done = true
    child.kill('SIGTERM')
    release(dir)
  }
  child.once('exit', (code, signal) => {
    if (done) return
    fail(dir, `${argv[0]} ended while held (${signal ?? `exit ${code}`})`)
    release(dir)
    process.exit(1)
  })
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.once(signal, () => {
      stop()
      process.exit(0)
    })
  }

  for (;;) {
    const left = lastActivity(dir) + seconds * 1000 - Date.now()
    if (left > 0) {
      await sleep(left + MARGIN_MS)
      continue
    }
    release(dir)
    // A hook that found this keeper alive had touched the activity before it looked, so a sign
    // of work that came before the release shows in this second read.
    if (lastActivity(dir) + seconds * 1000 > Date.now() && (await claim(dir))) continue
    break
  }
  stop()
}

export function status(dir, env = process.env, now = Date.now()) {
  const pid = keeper(dir)
  const left = Math.round((lastActivity(dir) + windowSeconds(env) * 1000 - now) / 1000)
  if (pid) return `Awake: held by keeper ${pid}, ${Math.max(left, 0)}s after the last activity.`
  const why = failure(dir)
  return why ? `Not held: ${why}` : 'Not held: no agent has worked recently.'
}

function startHolder(argv, env) {
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'ignore', 'pipe'], env })
  // What it says while starting is the reason when it is refused; afterwards nothing is read.
  let said = ''
  child.stderr.setEncoding('utf8').on('data', (text) => (said += text))
  return new Promise((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`${argv[0]}: ${error.message}`)))
    child.once('spawn', () => {
      const settled = setTimeout(() => {
        child.removeAllListeners('exit')
        child.stderr.destroy()
        resolve(child)
      }, SETTLE_MS)
      child.once('exit', (code, signal) => {
        clearTimeout(settled)
        const reason = said.trim().split('\n')[0]
        const how = signal ?? `exit ${code}`
        reject(new Error(`${argv[0]} ended at once (${how})${reason ? `: ${reason}` : ''}`))
      })
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2)
  if (!dir || !['launch', 'run', 'status'].includes(command)) {
    console.error('usage: keeper.mjs launch|run|status <dir>')
    process.exit(2)
  }
  try {
    if (command === 'launch') await launch(dir)
    else if (command === 'run') await run(dir)
    else console.log(status(dir))
  } catch (error) {
    log(dir, `${command}: ${error?.stack ?? error}`)
    process.exitCode = 1
  }
}
