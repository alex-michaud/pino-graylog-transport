import os from 'node:os'

export interface GelfMessage {
  version: '1.1'
  host: string
  short_message: string
  full_message?: string
  timestamp: number
  level: number
  _facility?: string
  [key: string]: unknown
}

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

export function formatGelfMessage(
  chunk: unknown,
  hostname: string,
  facility: string,
  staticMeta: Record<string, unknown> = {}
): string {
  // Parse the log object - it might come as a string or object
  let obj: Record<string, unknown>
  if (typeof chunk === 'string') {
    try {
      obj = JSON.parse(chunk)
    } catch {
      // If parsing fails, treat the whole string as the message
      obj = { msg: chunk }
    }
  } else if (Buffer.isBuffer(chunk)) {
    try {
      obj = JSON.parse(chunk.toString())
    } catch {
      obj = { msg: chunk.toString() }
    }
  } else {
    obj = chunk as Record<string, unknown>
  }

  // Extract the message - pino uses 'msg' field
  const message =
    (obj.msg as string) ||
    (obj.message as string) ||
    (obj.short_message as string) ||
    JSON.stringify(obj)

  // Build GELF 1.1 message
  const gelfMessage: GelfMessage = {
    version: '1.1',
    host: hostname,
    short_message: message,
    timestamp: obj.time ? (obj.time as number) / 1000 : Date.now() / 1000,
    level: mapPinoLevelToGelf(obj.level as number),
    _facility: facility,
    ...staticMeta,
  }

  // Add full_message if there's a stack trace
  if (obj.stack) {
    gelfMessage.full_message = obj.stack as string
  } else if (
    obj.err &&
    typeof obj.err === 'object' &&
    (obj.err as Record<string, unknown>).stack
  ) {
    gelfMessage.full_message = (obj.err as Record<string, unknown>).stack as string
  }

  // Add all other fields as GELF custom fields (prefixed with _)
  const excludedFields = [
    'msg',
    'message',
    'level',
    'time',
    'pid',
    'hostname',
    'stack',
    'v',
    'err',
  ]

  for (const [key, value] of Object.entries(obj)) {
    if (!excludedFields.includes(key) && value !== undefined && value !== null) {
      // GELF custom fields must start with underscore
      const fieldName = key.startsWith('_') ? key : `_${key}`

      // Avoid overwriting standard fields or static meta
      if (fieldName in gelfMessage) continue;

      // GELF doesn't support nested objects well, stringify them
      if (typeof value === 'object') {
        gelfMessage[fieldName] = JSON.stringify(value)
      } else {
        gelfMessage[fieldName] = value
      }
    }
  }

  // Add process info
  if (obj.pid) {
    gelfMessage._pid = obj.pid
  }

  return JSON.stringify(gelfMessage)
}

