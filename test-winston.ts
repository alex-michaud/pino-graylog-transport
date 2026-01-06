#!/usr/bin/env node
/**
 * Simple test script to debug winston-log2gelf connectivity
 */

import winston from 'winston'

const graylogHost = 'localhost'
const graylogPort = 12201

console.log('Testing winston-log2gelf...')
console.log(`Target: tcp://${graylogHost}:${graylogPort}`)

let winstonTransport = null

try {
  const Log2gelf = require('winston-log2gelf')
  console.log('✓ winston-log2gelf module loaded')

  // Log the available options from the module
  console.log('Log2gelf constructor:', typeof Log2gelf)

  winstonTransport = new Log2gelf({
    name: 'winston-test',
    graylogHost: graylogHost,
    graylogPort: graylogPort,
    protocol: 'tcp',
    environment: 'test',
    service: 'winston-test',
    level: 'info',
  })

  console.log('✓ Transport created')
  console.log('Transport type:', winstonTransport.constructor.name)

  // Add error handler
  winstonTransport.on('error', (err: Error) => {
    console.error('Transport error:', err.message)
  })

  // Add connected handler if available
  if (typeof winstonTransport.on === 'function') {
    winstonTransport.on('connect', () => {
      console.log('✓ Connected to Graylog')
    })
  }

} catch (err) {
  console.error('✗ Failed to load winston-log2gelf:', err)
  process.exit(1)
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { _test: 'winston-debug' },
  transports: [winstonTransport],
})

console.log('Sending test log...')
logger.info('Test message from winston-log2gelf debug script', {
  timestamp: new Date().toISOString(),
  testId: Math.random().toString(36).substring(7),
})

// Give it time to send
setTimeout(() => {
  console.log('Done. Check Graylog for the log message.')
  console.log('Search in Graylog: service:winston-test')

  // Try to close gracefully
  if (winstonTransport && typeof winstonTransport.close === 'function') {
    winstonTransport.close()
  }

  process.exit(0)
}, 3000)

