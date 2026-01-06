import { bench, group, run } from 'mitata'
import { formatGelfMessage } from '../../lib/gelf-formatter'

// Mock data
const pinoLog = {
  level: 30,
  time: 1609459200000,
  pid: 12345,
  hostname: 'benchmark-host',
  msg: 'Hello world',
  v: 1,
  req: {
    method: 'GET',
    url: '/api/test',
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
    remoteAddress: '127.0.0.1',
  },
  res: {
    statusCode: 200,
  },
  responseTime: 150,
}

const hostname = 'benchmark-host'
const facility = 'benchmark-app'
const options = { _env: 'production' }

// We benchmark formatting logic only (no network I/O)
group('GELF Formatting', () => {
  // Baseline: raw JSON.stringify of the original log object
  bench('JSON.stringify (Raw)', () => {
    JSON.stringify(pinoLog)
  })

  bench('pino-graylog-transport: formatGelfMessage', () => {
    formatGelfMessage(pinoLog, hostname, facility, staticMeta)
  })

  bench('Manual GELF Construction (Simulated Alternative)', () => {
    // This simulates what a typical "verbose" library might do
    const message = {
      version: '1.1',
      host: hostname,
      short_message: pinoLog.msg,
      full_message: JSON.stringify(pinoLog),
      timestamp: pinoLog.time / 1000,
      level: 6, // Info
      _facility: facility,
      _env: 'production',
      _pid: pinoLog.pid,
      _req: JSON.stringify(pinoLog.req),
      _res: JSON.stringify(pinoLog.res),
      _responseTime: pinoLog.responseTime,
    }
    JSON.stringify(message)
  })
})

;(async () => {
  await run()
})()
