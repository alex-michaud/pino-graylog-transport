import { Writable } from 'node:stream'
import tls from 'node:tls'
import net from 'node:net'
import os from 'node:os'
import { formatGelfMessage } from './gelf-formatter'

type GraylogTransportOpts = {
  host?: string
  port?: number
  protocol?: 'tcp' | 'tls'
  staticMeta?: Record<string, unknown>
  facility?: string
  hostname?: string
  onError?: (error: Error, context?: Record<string, unknown>) => void // Optional error handler
  onReady?: (success: boolean, error?: Error) => void // Optional ready/failed callback
  maxQueueSize?: number // Maximum number of messages to queue (default: 1000)
}

/**
 * Custom Pino transport for Graylog.
 *
 * Establishes a persistent TCP or TLS connection to the Graylog endpoint and
 * sends log entries in GELF 1.1 format. If the connection is not yet
 * established or is temporarily unavailable, log messages are queued in
 * memory and flushed once the connection is (re)established.
 *
 * To prevent unbounded memory growth, the queue has a maximum size (default: 1000).
 * When the queue is full, the oldest messages are dropped (FIFO). Dropped message
 * count is tracked and warnings are emitted periodically.
 *
 * OVH requires:
 * - TLS connection (not plain TCP/UDP)
 * - Port 12202 for GELF over TLS
 * - X-OVH-TOKEN in the GELF message
 * - Null byte terminator for each message
 * - GELF 1.1 format
 *
 * @param {GraylogTransportOpts} opts Options for configuring the Graylog transport.
 * @param {string} [opts.host] Graylog host to connect to. Defaults to the OVH Logs Data Platform host.
 * @param {number} [opts.port] Graylog port. Defaults to 12202 (GELF over TLS for OVH).
 * @param {Record<string, unknown>} [opts.staticMeta] Static fields to include in every GELF message.
 * @param {string} [opts.facility] GELF facility value identifying this application/service.
 * @param {string} [opts.hostname] Hostname to include in GELF messages. Defaults to the OS hostname.
 * @param {number} [opts.maxQueueSize] Maximum number of messages to queue before dropping oldest. Defaults to 1000.
 * @param {Function} [opts.onError] Custom error handler callback. Defaults to console.error.
 * @param {Function} [opts.onReady] Callback invoked once when connection succeeds or fails initially.
 * @returns {Writable} A Node.js Writable stream compatible with Pino's transport interface.
 */
export default function graylogTransport(opts: GraylogTransportOpts): Writable {
  const host = opts.host ?? 'bhs1.logs.ovh.com'
  const port = opts.port ?? 12202 // Default to OVH GELF over TLS port
  const protocol = opts.protocol ?? 'tls'
  const staticMeta = opts.staticMeta ?? {}
  const hostname = opts.hostname ?? os.hostname()
  const facility = opts.facility ?? hostname // Use hostname as facility if not provided
  const maxQueueSize = opts.maxQueueSize ?? 1000 // Default: queue max 1000 messages
  const onError =
    opts.onError ??
    ((error: Error, context?: Record<string, unknown>) => {
      // Default error handler: log to console
      // This can be overridden by passing a custom onError callback
      console.error('Graylog transport error:', error.message, context || {})
    })
  const onReady = opts.onReady // Optional ready callback

  // Connection state
  let socket: net.Socket | null = null
  let connectionPromise: Promise<net.Socket> | null = null
  let messageQueue: string[] = []
  let initializationAttempted = false
  let isReady = false
  let droppedMessageCount = 0 // Track how many messages were dropped due to queue overflow

  // Helper function to handle errors consistently
  const handleError = (error: Error, context?: Record<string, unknown>) => {
    onError(error, context)
  }


  const connect = (): Promise<net.Socket> => {
    // If already connected, return the existing socket
    if (socket && !socket.destroyed) {
      return Promise.resolve(socket)
    }

    // If connection is in progress, return the existing promise
    // This prevents race conditions where multiple concurrent calls
    // try to create connections before any of them completes
    if (connectionPromise) {
      return connectionPromise
    }

    // Immediately create and assign the promise to prevent race conditions
    // Any subsequent calls will see connectionPromise !== null and return it
    connectionPromise = new Promise<net.Socket>((resolve, reject) => {
      // Set timeout for connection attempt (10 seconds)
      const connectionTimeout = setTimeout(() => {
        const timeoutError = new Error('Graylog connection timeout')
        newSocket.destroy()
        socket = null
        connectionPromise = null
        reject(timeoutError)
      }, 10000)

      const onConnect = () => {
        // Clear the connection timeout on successful connection
        clearTimeout(connectionTimeout)

        socket = newSocket
        isReady = true

        // Notify that transport is ready (only on first successful connection)
        if (!initializationAttempted && onReady) {
          initializationAttempted = true
          onReady(true)
        }

        // Flush queued messages
        const messagesToFlush = [...messageQueue]
        messageQueue = []

        for (const msg of messagesToFlush) {
          if (socket && !socket.destroyed) {
            socket.write(msg)
          }
        }

        // Clear connectionPromise AFTER flushing to prevent race
        connectionPromise = null
        resolve(newSocket)
      }

      let newSocket: net.Socket
      if (protocol === 'tcp') {
        newSocket = net.createConnection({ host, port }, onConnect)
      } else {
        newSocket = tls.connect(
          {
            host,
            port,
            rejectUnauthorized: true, // Verify OVH's certificate
          },
          onConnect,
        )
      }

      newSocket.on('error', (err: Error) => {
        // Clear timeout on error
        clearTimeout(connectionTimeout)
        handleError(err, { host, port, reason: `${protocol.toUpperCase()} connection error` })
        socket = null
        connectionPromise = null
        reject(err)
      })

      newSocket.on('close', () => {
        // Clear timeout if socket closes
        clearTimeout(connectionTimeout)
        socket = null
        // Only clear connectionPromise if this is the current connection
        // Prevents race where a new connection starts before close event fires
        if (connectionPromise) {
          connectionPromise = null
        }
      })
    })

    return connectionPromise
  }

  const sendMessage = (gelfMessage: string) => {
    // GELF over TCP requires null byte terminator
    const messageWithTerminator = gelfMessage + '\0'

    if (socket && !socket.destroyed) {
      socket.write(messageWithTerminator)
    } else {
      // Queue message if not connected
      // Check if queue is at capacity
      if (messageQueue.length >= maxQueueSize) {
        // Drop oldest message (FIFO) to make room
        messageQueue.shift()
        droppedMessageCount++

        // Warn about dropped messages (but only occasionally to avoid spam)
        if (droppedMessageCount % 100 === 1) {
          handleError(
            new Error('Graylog message queue overflow'),
            {
              reason: 'Queue at max capacity, dropping oldest messages',
              queueSize: maxQueueSize,
              droppedCount: droppedMessageCount,
            }
          )
        }
      }

      messageQueue.push(messageWithTerminator)

      // Attempt to connect
      connect().catch((err) => {
        handleError(err, { reason: 'Failed to connect while sending message' })
      })
    }
  }

  // Establish initial connection
  connect()
    .then(() => {
      // Connection successful - isReady flag already set in connect()
    })
    .catch((err) => {
      handleError(err, { reason: 'Initial Graylog connection failed' })

      // Notify that transport initialization failed
      if (!initializationAttempted && onReady) {
        initializationAttempted = true
        onReady(false, err)
      }

      // Mark as not ready - messages will queue until connection succeeds
      isReady = false
    })

  const writableStream = new Writable({
    objectMode: true,
    write(chunk: unknown, _enc: BufferEncoding, cb: () => void) {
      try {
        const gelfMessage = formatGelfMessage(chunk, hostname, facility, staticMeta)
        sendMessage(gelfMessage)
      } catch (err) {
        handleError(err instanceof Error ? err : new Error(String(err)), {
          reason: 'Failed to process log entry',
          chunk: typeof chunk === 'string' ? chunk : '[Buffer or Object]',
        })
      } finally {
        cb()
      }
    },

    final(cb: (error?: Error | null) => void) {
      // Close socket on stream end
      if (socket && !socket.destroyed) {
        socket.end()
      }
      cb()
    },

    destroy(err: Error | null, cb: (error?: Error | null) => void) {
      if (socket && !socket.destroyed) {
        socket.destroy()
      }
      cb(err)
    },
  })

  // Expose utility methods for checking transport status
  // These can be used by the parent logger to monitor health
  Object.assign(writableStream, {
    isReady: () => isReady,
    getQueueSize: () => messageQueue.length,
    isConnected: () => socket !== null && !socket.destroyed,
    getDroppedMessageCount: () => droppedMessageCount,
    getMaxQueueSize: () => maxQueueSize,
  })

  return writableStream
}
