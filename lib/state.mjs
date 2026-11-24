// The folder the hook and the keeper share, one per user (`bin/awake` names it):
//
//   activity     touched by the hook on every sign of work; its time is the last activity
//   keeper.pid   the running keeper's process id; replaced only under `claim.lock`, so one runs
//   failed       why the last keeper could not hold the computer awake; the hook waits it out
//   awake.log    what went wrong, kept short

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_SECONDS = 900
const LOG_LIMIT = 256 * 1024

export const paths = (dir) => ({
  activity: join(dir, 'activity'),
  pid: join(dir, 'keeper.pid'),
  failed: join(dir, 'failed'),
  log: join(dir, 'awake.log'),
})

/** How long the computer stays awake after the last sign of work: `AWAKE_SECONDS`, else 900. */
export function windowSeconds(env) {
  const value = env.AWAKE_SECONDS?.trim() ?? ''
  return /^[1-9]\d*$/.test(value) ? Number(value) : DEFAULT_SECONDS
}

/** The time of the last sign of work, in milliseconds; 0 when there was none. */
export function lastActivity(dir) {
  try {
    return statSync(paths(dir).activity).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Makes a process the keeper unless one is alive: under a short lock, so that of two processes
 * that both find the keeper gone only one replaces it. `start` gives the new keeper's id (it may
 * start the process); resolves to that id, or `null` when another keeper is alive.
 * @param {() => number | Promise<number>} start
 */
export async function claim(dir, start = () => process.pid) {
  const lock = join(dir, 'claim.lock')
  if (!takeLock(lock)) return null
  try {
    const other = readPid(paths(dir).pid)
    if (other && other !== process.pid && alive(other)) return null
    const pid = await start()
    // Whole or not at all: the hook reads this file without the lock.
    const temp = `${paths(dir).pid}.${process.pid}`
    writeFileSync(temp, `${pid}\n`)
    renameSync(temp, paths(dir).pid)
    return pid
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

/** A lock left by a process that died holding it is taken over after this long. */
const LOCK_STALE_MS = 5000

function takeLock(lock) {
  try {
    mkdirSync(lock)
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  let age = 0
  try {
    age = Date.now() - statSync(lock).mtimeMs
  } catch {}
  if (age < LOCK_STALE_MS) return false
  rmSync(lock, { recursive: true, force: true })
  try {
    mkdirSync(lock)
    return true
  } catch {
    return false
  }
}

/** Gives up being the keeper, if this process still is. */
export function release(dir, pid = process.pid) {
  const file = paths(dir).pid
  if (readPid(file) === pid) rmSync(file, { force: true })
}

/** The running keeper's process id, or `null`. */
export function keeper(dir) {
  const pid = readPid(paths(dir).pid)
  return pid && alive(pid) ? pid : null
}

export function fail(dir, message) {
  writeFileSync(paths(dir).failed, `${message}\n`)
  log(dir, message)
}

export function failure(dir) {
  try {
    return readFileSync(paths(dir).failed, 'utf8').trim()
  } catch {
    return null
  }
}

export function clearFailure(dir) {
  rmSync(paths(dir).failed, { force: true })
}

/** Appends one line to `awake.log`; past its limit the log starts over. */
export function log(dir, message) {
  try {
    const file = paths(dir).log
    let size = 0
    try {
      size = statSync(file).size
    } catch {}
    if (size > LOG_LIMIT) rmSync(file, { force: true })
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Nowhere left to report to: the keeper goes on without its log.
  }
}

function readPid(file) {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: alive, but another user's; never ours to replace.
    return error.code === 'EPERM'
  }
}
