#!/usr/bin/env node
// Child process that receives log messages via IPC and forwards them to Graylog
const net = require('net')
const tls = require('tls')
const os = require('os')
const path = require('path')

// Try to load the dist gelf formatter (built by tsc). Fall back to a simple JSON stringifier.
let formatGelfMessage = null
try {
  const gf = require(path.resolve(process.cwd(), 'dist', 'gelf-formatter.js'))
  formatGelfMessage = gf.formatGelfMessage || (gf.default && gf.default.formatGelfMessage)
} catch (e) {
  // no-op; we'll stringify
}

const HOST = process.env.GRAYLOG_HOST || 'localhost'
const PORT = Number(process.env.GRAYLOG_PORT || 12201)
const PROTOCOL = process.env.GRAYLOG_PROTOCOL || 'tcp'
const STATIC_META = process.env.GRAYLOG_STATICMETA ? JSON.parse(process.env.GRAYLOG_STATICMETA) : {}
const HOSTNAME = process.env.GRAYLOG_HOSTNAME || os.hostname()
const FACILITY = process.env.GRAYLOG_FACILITY || HOSTNAME

let socket = null
let connected = false
let queue = []

function connect() {
  if (socket && !socket.destroyed) return
  if (PROTOCOL === 'tcp') {
    socket = net.createConnection({ host: HOST, port: PORT }, onConnect)
  } else {
    socket = tls.connect({ host: HOST, port: PORT, rejectUnauthorized: true }, onConnect)
  }
  socket.setNoDelay(true)
  socket.setKeepAlive(true)

  socket.on('error', (err) => {
    // Forward to parent for visibility
    if (process.send) process.send({ type: 'child-error', message: String(err) })
  })

  socket.on('close', () => {
    connected = false
    socket = null
  })
}

function onConnect() {
  connected = true
  if (process.send) process.send({ type: 'ready', success: true })
  // flush queue
  while (queue.length > 0) {
    const str = queue.shift()
    try { socket.write(str + '\0') } catch (e) {}
  }
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'log') {
    try {
      // msg.payload is the original chunk (object or string)
      let gelf
      if (formatGelfMessage) {
        gelf = formatGelfMessage(msg.payload, HOSTNAME, FACILITY, STATIC_META)
      } else {
        // Fallback: simple JSON line
        gelf = JSON.stringify({ short_message: typeof msg.payload === 'object' ? msg.payload : String(msg.payload), host: HOSTNAME, _facility: FACILITY, ...STATIC_META })
      }

      if (connected && socket && !socket.destroyed) {
        socket.write(gelf + '\0')
      } else {
        queue.push(gelf)
        connect()
      }
    } catch (err) {
      if (process.send) process.send({ type: 'child-error', message: String(err) })
    }
  }
})

// Start connection proactively
connect()

// Ensure child exits cleanly on parent disconnect
process.on('disconnect', () => {
  try { if (socket && !socket.destroyed) socket.end() } catch (e) {}
  process.exit(0)
})

