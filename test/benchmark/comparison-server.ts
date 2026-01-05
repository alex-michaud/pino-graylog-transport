#!/usr/bin/env node
import http from 'http'
import pino from 'pino'
import winston from 'winston'
import transport from '../../lib/index'

/**
 * Comparison server for benchmarking logging performance
 *
 * Endpoints:
 * - GET /health - Health check
 * - POST /baseline - No logging (baseline)
 * - POST /pino - Logs with pino-graylog-transport
 * - POST /winston - Logs with winston + winston-graylog2
 */

// Parse command line arguments
const args = process.argv.slice(2)
const port = parseInt(args[0] || '3001', 10)
const graylogHost = args[1] || 'localhost'
const graylogPort = parseInt(args[2] || '12201', 10)

// Setup Pino with our transport
const pinoTransport = transport({
  host: graylogHost,
  port: graylogPort,
  protocol: 'tcp',
  facility: 'pino-benchmark',
  staticMeta: { _benchmark: 'pino' }
})

const pinoLogger = pino({ level: 'info' }, pinoTransport)

// Setup Winston with winston-graylog2 (dynamically required to avoid type issues)
let winstonGraylogTransport: any = null
try {
  // winston-graylog2 exports a transport class (often as module.Graylog)
  const winstonGraylogModule: any = require('winston-graylog2')
  const GraylogTransportClass = winstonGraylogModule.Graylog || winstonGraylogModule
  winstonGraylogTransport = new GraylogTransportClass({
    servers: [{ host: graylogHost, port: graylogPort }],
    facility: 'winston-benchmark',
  })
} catch (err) {
  // If the module isn't installed, log a helpful message — the comparison server can still run (it will just not send to Graylog)
  console.warn('winston-graylog2 not installed; Winston logs will be no-ops for Graylog. Install with: npm install winston-graylog2')
}

const winstonTransports: any[] = []
if (winstonGraylogTransport) {
  winstonTransports.push(winstonGraylogTransport)
} else {
  // Fallback to console transport so logs are still captured locally
  winstonTransports.push(new winston.transports.Console())
}

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: winstonTransports,
})

function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const requestId = generateRequestId()

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  // Baseline - no logging
  if (req.method === 'POST' && req.url === '/baseline') {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      // Simulate some work (parse JSON)
      try {
        JSON.parse(body)
      } catch { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, logger: 'none', requestId }))
    })
    return
  }

  // Pino with our transport
  if (req.method === 'POST' && req.url === '/pino') {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        pinoLogger.info({ requestId, ...data.metadata }, data.message || 'Pino benchmark log')
      } catch {
        pinoLogger.info({ requestId }, 'Pino benchmark log')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, logger: 'pino', requestId }))
    })
    return
  }

  // Winston with winston-graylog2
  if (req.method === 'POST' && req.url === '/winston') {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        winstonLogger.info(data.message || 'Winston benchmark log', { requestId, ...data.metadata })
      } catch {
        winstonLogger.info('Winston benchmark log', { requestId })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, logger: 'winston', requestId }))
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(port, () => {
  console.log(`Comparison benchmark server running on port ${port}`)
  console.log(`Graylog: tcp://${graylogHost}:${graylogPort}`)
  console.log('')
  console.log('Endpoints:')
  console.log('  POST /baseline - No logging (baseline)')
  console.log('  POST /pino     - pino-graylog-transport')
  console.log('  POST /winston  - winston + winston-graylog2')
  console.log('  GET  /health   - Health check')
})

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close(() => {
    try { if (winstonGraylogTransport && typeof winstonGraylogTransport.close === 'function') winstonGraylogTransport.close() } catch {}
    try { pinoTransport.end() } catch {}
    console.log('Server closed')
    process.exit(0)
  })
})
