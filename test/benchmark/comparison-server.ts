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
 * - POST /winston - Logs with winston + winston-log2gelf
 */

// Parse command line arguments
const args = process.argv.slice(2)
const port = Number.parseInt(args[0] || '3001', 10)
const graylogHost = args[1] || 'localhost'
const graylogPort = Number.parseInt(args[2] || '12201', 10)

// Setup Pino with our transport (in-process for consistent benchmarks)
const pinoTransport = transport({
  host: graylogHost,
  port: graylogPort,
  protocol: 'tcp',
  facility: 'pino-benchmark',
  staticMeta: { benchmark: 'pino' }, // Note: no underscore - GELF formatter adds it
  // Match Winston's fire-and-forget behavior for fair comparison
  waitForDrain: false,
  dropWhenFull: true,
  maxQueueSize: 10000,
})

const pinoLogger = pino({ level: 'info' }, pinoTransport)

// --- WINSTON SETUP ---
let winstonGraylogTransport: any = null
let winstonStatus = 'initializing'

try {
  // winston-log2gelf exports a transport class
  const Log2gelf = require('winston-log2gelf')

  winstonGraylogTransport = new Log2gelf({
    name: 'winston-graylog',
    host: graylogHost,
    port: graylogPort,
    protocol: 'tcp', // Use TCP to match Pino transport and ensure reliability
    environment: 'benchmark',
    service: 'winston-benchmark',
    level: 'info',
    handleExceptions: true,
  })

  // Add error handler to catch connectivity issues
  winstonGraylogTransport.on('error', (err: any) => {
    console.error('🚨 Winston Transport Error:', err.message)
  })

  // Add connected handler if available
  winstonGraylogTransport.on('connected', () => {
    console.log('✓ Winston connected to Graylog')
  })

  console.log(
    `Winston transport configured: tcp://${graylogHost}:${graylogPort}`,
  )
  winstonStatus = 'connected (winston-log2gelf)'
} catch (err: unknown) {
  winstonStatus = 'fallback (Console)'
  console.error('\n❌ winston-log2gelf NOT found.')
  console.error('   To fix: npm install winston-log2gelf')
  console.error(
    '   Winston logs will be printed to stdout instead of Graylog.\n',
  )
}

const winstonTransports: any[] = []
if (winstonGraylogTransport) {
  winstonTransports.push(winstonGraylogTransport)
} else {
  winstonTransports.push(new winston.transports.Console())
}

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { benchmark: 'winston' }, // Note: no underscore - winston-log2gelf adds it for GELF
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
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      // Simulate some work (parse JSON)
      try {
        JSON.parse(body)
      } catch {
        /* ignore */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, logger: 'none', requestId }))
    })
    return
  }

  // Pino with our transport
  if (req.method === 'POST' && req.url === '/pino') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        pinoLogger.info(
          { requestId, ...data.metadata },
          data.message || 'Pino benchmark log',
        )
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
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        winstonLogger.info(data.message || 'Winston benchmark log', {
          requestId,
          ...data.metadata,
        })
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
  console.log('Pino:    connected (TCP)')
  console.log(`Winston: ${winstonStatus}`)
  console.log('')
  console.log('Endpoints:')
  console.log('  POST /baseline - No logging (baseline)')
  console.log('  POST /pino     - pino-graylog-transport')
  console.log('  POST /winston  - winston + winston-log2gelf')
  console.log('  GET  /health   - Health check')
})

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close(() => {
    // winston-log2gelf might not have a close method, or it might be different.
    // We try to close if possible.
    try {
      if (
        winstonGraylogTransport &&
        typeof winstonGraylogTransport.close === 'function'
      )
        winstonGraylogTransport.close()
    } catch {}
    try {
      pinoTransport.end()
    } catch {}
    console.log('Server closed')
    process.exit(0)
  })
})
