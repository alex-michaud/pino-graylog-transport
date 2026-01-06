#!/usr/bin/env node
import http from 'node:http'
import pino from 'pino'
import transport from '../../lib/index'

/**
 * Load test helper application
 * This creates a simple HTTP server that logs messages using the pino-graylog-transport
 * Can be used with k6 to generate load and test the transport performance
 */

// Parse command line arguments
const args = process.argv.slice(2)
const port = Number.parseInt(args[0] || '3000', 10)
const graylogHost = args[1] || 'localhost'
const graylogPort = Number.parseInt(args[2] || '12201', 10)
const protocol = (args[3] || 'tcp') as 'tcp' | 'tls'

let logger: pino.Logger

async function startServer() {
  try {
    // Create the transport
    const transportInstance = transport({
      host: graylogHost,
      port: graylogPort,
      protocol: protocol,
      facility: 'load-test-app',
      staticMeta: { _env: 'load-test' },
    })

    // Create pino logger with the transport
    logger = pino(transportInstance)

    // Create HTTP server
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }

      if (req.method === 'POST' && req.url === '/log') {
        let body = ''

        req.on('data', (chunk) => {
          body += chunk.toString()
        })

        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const level = (data.level || 'info') as pino.Level
            const message = data.message || 'Log message'
            const metadata = data.metadata || {}

            // Log based on level
            if (logger[level]) {
              logger[level](
                { ...metadata, requestId: generateRequestId() },
                message,
              )
            } else {
              logger.info(
                { ...metadata, requestId: generateRequestId() },
                message,
              )
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err) {
            logger.error({ err }, 'Error processing log request')
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })

        return
      }

      res.writeHead(404)
      res.end()
    })

    server.listen(port, () => {
      console.log(`Load test server running on port ${port}`)
      console.log(`Graylog: ${protocol}://${graylogHost}:${graylogPort}`)
      console.log('POST /log to generate log messages')
      console.log('GET /health for health check')
    })

    // Handle shutdown gracefully
    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close(() => {
        console.log('Server closed')
        process.exit(0)
      })
    })
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

startServer()
