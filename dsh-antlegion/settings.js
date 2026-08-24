/**
 * settings.js — the handful of fields the setup page may change, on disk.
 *
 * A DCU is configured the way every other dsh plugin is: a row in the profile's
 * `cordis.patch.yml`. That is right for an operator and wrong for the five
 * minutes after `dsh plugin add`, when the thing you need is an address and a
 * way to check it — not a YAML file whose path you have to learn first.
 *
 * So the setup page writes here instead of rewriting the operator's patch: a
 * file this plugin owns, holding only the fields the page edits. Merging it is
 * a pure function, and every field carries where it came from, because a
 * setting that silently overrides a file someone wrote by hand is the same
 * class of surprise as a Δ that changes on restart.
 *
 * No harness imports: this folds under `node --test` with only the bus present.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Exactly the fields the setup page owns. Nothing else may be overlaid. */
export const SETTABLE = ['busUrl', 'author', 'interests', 'publishes']

/** §B limits, so the page cannot save a value the bus would reject on append. */
const MAX_STRING_BYTES = 256
const MAX_LIST_ENTRIES = 64

/** Where the overlay lives. One per home unless a profile says otherwise. */
export function settingsPath(configured) {
  if (configured) return configured
  if (process.env.ANTLEGION_DCU_SETTINGS) return process.env.ANTLEGION_DCU_SETTINGS
  return join(homedir(), '.antlegion', 'dsh-dcu.json')
}

/** Read the overlay. A missing or unreadable file is simply "nothing saved". */
export function readSettings(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    // A corrupt overlay must not take the DCU down — it falls back to the
    // profile config, which is a working configuration by definition.
    return null
  }
}

/** Write the overlay durably enough that a crash cannot leave half a file. */
export function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
  renameSync(tmp, path)
}

const byteLength = (value) => Buffer.byteLength(String(value), 'utf-8')

/**
 * Validate one submitted patch.
 *
 * This endpoint decides which log this agent's facts land in and whose name
 * they carry, so it validates rather than trusts — and it validates against the
 * protocol's own limits, so a value that saves is a value that appends.
 *
 * @returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function validateSettings(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'expected a JSON object' }
  }
  const unknown = Object.keys(input).filter((k) => !SETTABLE.includes(k))
  if (unknown.length > 0) {
    return { ok: false, error: `not settable here: ${unknown.join(', ')} — edit the profile's cordis.patch.yml` }
  }

  const value = {}

  if (input.busUrl !== undefined) {
    if (typeof input.busUrl !== 'string' || input.busUrl.trim() === '') {
      return { ok: false, error: 'busUrl must be a non-empty string' }
    }
    const trimmed = input.busUrl.trim().replace(/\/$/, '')
    let parsed
    try {
      parsed = new URL(trimmed)
    } catch {
      return { ok: false, error: `busUrl is not a URL: ${trimmed}` }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: `busUrl must be http or https, not ${parsed.protocol}` }
    }
    value.busUrl = trimmed
  }

  if (input.author !== undefined) {
    if (typeof input.author !== 'string' || input.author.trim() === '') {
      return { ok: false, error: 'author must be a non-empty string' }
    }
    const author = input.author.trim()
    if (byteLength(author) > MAX_STRING_BYTES) {
      return { ok: false, error: `author exceeds ${MAX_STRING_BYTES} bytes (§5.2)` }
    }
    value.author = author
  }

  for (const key of ['interests', 'publishes']) {
    if (input[key] === undefined) continue
    if (!Array.isArray(input[key])) return { ok: false, error: `${key} must be an array of strings` }
    const list = input[key].map((entry) => (typeof entry === 'string' ? entry.trim() : entry)).filter((e) => e !== '')
    if (list.some((entry) => typeof entry !== 'string')) {
      return { ok: false, error: `${key} must be an array of strings` }
    }
    if (list.length > MAX_LIST_ENTRIES) {
      return { ok: false, error: `${key} holds more than ${MAX_LIST_ENTRIES} entries (§B) — every one is a glob every reader evaluates` }
    }
    const tooLong = list.find((entry) => byteLength(entry) > MAX_STRING_BYTES)
    if (tooLong !== undefined) return { ok: false, error: `${key} entry exceeds ${MAX_STRING_BYTES} bytes: ${tooLong.slice(0, 40)}…` }
    value[key] = list
  }

  return { ok: true, value }
}

/**
 * Merge a saved overlay over the profile config.
 *
 * @returns `{ config, source }` where `source[field]` is `'setup-ui'` or
 *   `'profile'`. The caller shows that; nothing here is applied silently.
 */
export function mergeSettings(config, settings) {
  const merged = { ...config }
  const source = {}
  for (const key of SETTABLE) {
    const saved = settings?.[key]
    const isSet = Array.isArray(saved) ? true : saved !== undefined && saved !== null && saved !== ''
    if (isSet) {
      merged[key] = saved
      source[key] = 'setup-ui'
    } else {
      source[key] = 'profile'
    }
  }
  return { config: merged, source }
}
