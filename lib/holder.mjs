// The system's own keep-awake program, held for as long as one process lives: the keeper. Tied to
// the keeper's process id, it ends with it however the keeper ends, a crash or a kill included.

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * The argument vector that holds the computer awake until process `pid` exits, or `null` where
 * this system has no such program.
 * @param {NodeJS.Platform} platform
 * @param {number} pid
 * @param {Record<string, string | undefined>} env
 * @returns {string[] | null}
 */
export function holder(platform, pid, env) {
  if (platform === 'darwin') {
    // -d display, -i idle sleep, -m disk, -s system sleep on AC power.
    const flags = (env.AWAKE_CAFFEINATE_FLAGS ?? '-dims').split(/\s+/).filter(Boolean)
    return ['caffeinate', ...flags, '-w', String(pid)]
  }
  if (platform === 'linux' && onPath('systemd-inhibit', env)) {
    return [
      'systemd-inhibit',
      `--what=${env.AWAKE_INHIBIT_WHAT ?? 'idle:sleep'}`,
      '--who=awake',
      '--why=An agent is working',
      'tail',
      `--pid=${pid}`,
      '-f',
      '/dev/null',
    ]
  }
  return null
}

function onPath(name, env) {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  return dirs.some((dir) => existsSync(join(dir, name)))
}
