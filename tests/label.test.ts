import { expect, test } from 'claude-code/testing'
import { label, stateDir, untilChange, windowSeconds } from '../hooks/label'

const NOW = 1_800_000_000_000
const MIN = 60_000

test('nothing is shown while no agent has worked within the window', async () => {
  expect(label({ now: NOW, window: 900 })).toBeUndefined()
  expect(label({ now: NOW, activity: NOW - 16 * MIN, window: 900 })).toBeUndefined()
})

test('the minutes left, rounded up', async () => {
  expect(label({ now: NOW, activity: NOW, window: 900 })).toBe('15m')
  expect(label({ now: NOW, activity: NOW - 10.5 * MIN, window: 900 })).toBe('5m')
  expect(label({ now: NOW, activity: NOW - 14.5 * MIN, window: 900 })).toBe('1m')
})

test('a refused hold says so while the agent works', async () => {
  expect(label({ now: NOW, activity: NOW, failed: NOW - MIN, window: 900 })).toBe('not held')
})

test('the folder and the window are read as bin/awake reads them', async () => {
  expect(stateDir({ AWAKE_DIR: '/x' })).toBe('/x')
  expect(stateDir({ XDG_RUNTIME_DIR: '/run/user/1000', USER: 'ann' })).toBe(
    '/run/user/1000/localix-awake-ann',
  )
  expect(stateDir({ TMPDIR: '/var/folders/t/', USER: 'ann' })).toBe(
    '/var/folders/t//localix-awake-ann',
  )
  expect(stateDir({ USER: 'ann' })).toBe('/tmp/localix-awake-ann')
  expect(stateDir({})).toBeUndefined()
  expect(windowSeconds('60')).toBe(60)
  expect(windowSeconds('0')).toBe(900)
})

test('the next change is the next minute down, then the end of the hold', async () => {
  expect(untilChange({ now: NOW, activity: NOW, window: 900 })).toBe(MIN)
  expect(untilChange({ now: NOW, activity: NOW - 10_000, window: 900 })).toBe(50_000)
  expect(untilChange({ now: NOW, activity: NOW - 14.5 * MIN, window: 900 })).toBe(30_000)
  expect(untilChange({ now: NOW, activity: NOW - 16 * MIN, window: 900 })).toBeUndefined()
})
