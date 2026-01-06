export interface GelfMessage {
  version: '1.1'
  host: string
  short_message: string
  full_message?: string
  timestamp: number
  level: number
  [key: string]: unknown
}

// OPTIMIZATION 1: Hoist constant outside the hot path and use Set for O(1) lookup
const EXCLUDED_FIELDS = new Set([
  'msg',
  'message',
  'level',
  'time',
  'pid',
  'hostname',
  'stack',
  'v',
  'err',
])

export const mapPinoLevelToGelf = (pinoLevel: number | undefined): number => {
  // Pino levels: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal
  // GELF levels: 0 emergency, 1 alert, 2 critical, 3 error, 4 warning, 5 notice, 6 info, 7 debug
  if (!pinoLevel) return 6 // default to info
  if (pinoLevel >= 60) return 2 // fatal -> critical
  if (pinoLevel >= 50) return 3 // error
  if (pinoLevel >= 40) return 4 // warning
  if (pinoLevel >= 30) return 6 // info
  if (pinoLevel >= 20) return 7 // debug
  return 7 // trace -> debug
}

function parseChunk(chunk: unknown): Record<string, unknown> {
  // OPTIMIZATION: Check object type first (most common case from Pino)
  if (typeof chunk === 'object' && chunk !== null) {
    return chunk as Record<string, unknown>
  }

  // Handle strings and buffers
  let str = ''
  if (typeof chunk === 'string') {
    str = chunk
  } else if (Buffer.isBuffer(chunk)) {
    str = chunk.toString()
  }

  // OPTIMIZATION 3: Heuristic check - only try parsing if it looks like JSON
  // This avoids expensive try-catch throws on plain text logs
  const firstChar = str.trim()[0]
  if (firstChar === '{' || firstChar === '[') {
    try {
      return JSON.parse(str)
    } catch {
      // If parse fails despite looking like JSON, fall back to wrapping it
    }
  }

  return { msg: str }
}

function extractMessage(obj: Record<string, unknown>): string {
  // OPTIMIZATION: Use explicit type checks (slightly faster than truthiness)
  if (typeof obj.msg === 'string') return obj.msg
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.short_message === 'string') return obj.short_message
  return JSON.stringify(obj)
}

function addStaticMetadata(
  gelfMessage: GelfMessage,
  staticMeta: Record<string, unknown>,
): void {
  // OPTIMIZATION 2: Use for...in to avoid allocating Object.entries array
  for (const key in staticMeta) {
    const value = staticMeta[key]
    if (value !== undefined && value !== null) {
      // OPTIMIZATION: Use charCodeAt for underscore check (95 is '_')
      const fieldName = key.charCodeAt(0) === 95 ? key : `_${key}`
      gelfMessage[fieldName] =
        typeof value === 'object' ? JSON.stringify(value) : value
    }
  }
}

function addStackTrace(
  gelfMessage: GelfMessage,
  obj: Record<string, unknown>,
): void {
  // Check for direct stack
  if (typeof obj.stack === 'string') {
    gelfMessage.full_message = obj.stack
    return
  }

  // Check for nested err.stack using optional chaining
  const err = obj.err as Record<string, unknown> | undefined
  if (typeof err?.stack === 'string') {
    gelfMessage.full_message = err.stack
  }
}

function addCustomFields(
  gelfMessage: GelfMessage,
  obj: Record<string, unknown>,
): void {
  // OPTIMIZATION 2: Use for...in loop instead of Object.entries
  for (const key in obj) {
    // OPTIMIZATION 1: O(1) lookup in Set instead of Array.includes
    if (EXCLUDED_FIELDS.has(key)) continue

    const value = obj[key]
    if (value === undefined || value === null) continue

    // OPTIMIZATION: Use charCodeAt for underscore check
    const fieldName = key.charCodeAt(0) === 95 ? key : `_${key}`

    // Avoid overwriting standard fields or static meta
    if (fieldName in gelfMessage) continue

    // GELF doesn't support nested objects well, stringify them
    gelfMessage[fieldName] =
      typeof value === 'object' ? JSON.stringify(value) : value
  }

  // Add process info
  if (obj.pid) {
    gelfMessage._pid = obj.pid
  }
}

export function formatGelfMessage(
  chunk: unknown,
  hostname: string,
  facility: string,
  staticMeta: Record<string, unknown> = {},
): string {
  const obj = parseChunk(chunk)

  // Pino adds 'time' field automatically (milliseconds since epoch)
  // We preserve it to maintain accurate event timing even if messages are queued
  // Fallback to current time for non-Pino messages
  // OPTIMIZATION: Use typeof check and multiplication (faster than division)
  const timestamp =
    typeof obj.time === 'number' ? obj.time * 1e-3 : Date.now() * 1e-3

  // Build GELF 1.1 message
  const gelfMessage: GelfMessage = {
    version: '1.1',
    host: hostname,
    short_message: extractMessage(obj),
    timestamp,
    level: mapPinoLevelToGelf(obj.level as number),
  }

  // Add facility as additional field (deprecated in GELF spec, now sent as custom field)
  if (facility) {
    gelfMessage._facility = facility
  }

  addStaticMetadata(gelfMessage, staticMeta)
  addStackTrace(gelfMessage, obj)
  addCustomFields(gelfMessage, obj)

  return JSON.stringify(gelfMessage)
}
