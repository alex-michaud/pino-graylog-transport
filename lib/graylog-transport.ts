import net from 'node:net'
import os from 'node:os'
import { Writable } from 'node:stream'
import tls from 'node:tls'
import { formatGelfMessage } from './gelf-formatter'

// Runtime detection: Check if running in Bun (which has faster APIs)
const isBun = typeof process.versions.bun !== 'undefined'

type GraylogTransportOpts = {
  host?: string
  port?: number
  protocol?: 'tcp' | 'tls'
  staticMeta?: Record<string, unknown>
  facility?: string
  hostname?: string
  onError?: (error: Error, context?: Record<string, unknown>) => void
  onReady?: (success: boolean, error?: Error) => void
  maxQueueSize?: number
  // New options
  waitForDrain?: boolean // if true, wait for socket 'drain' before signaling write completion
  dropWhenFull?: boolean // if true, drop new messages when internal queue is full; otherwise drop oldest
  autoConnect?: boolean // if false, do not attempt to connect automatically in constructor
}

/**
 * A Writable stream that sends logs to Graylog and exposes status methods.
 */
export class GraylogWritable extends Writable {
  private socket: net.Socket | null = null
  private connectionPromise: Promise<net.Socket> | null = null
  private messageQueue: string[] = []
  private initializationAttempted = false
  private ready = false
  private droppedMessageCount = 0

  private readonly host: string
  private readonly port: number
  private readonly protocol: 'tcp' | 'tls'
  private readonly staticMeta: Record<string, unknown>
  private readonly hostname: string
  private readonly facility: string
  private readonly maxQueueSize: number
  private readonly waitForDrain: boolean
  private readonly dropWhenFull: boolean
  private readonly handleError: (
    error: Error,
    context?: Record<string, unknown>,
  ) => void
  private readonly onReady?: (success: boolean, error?: Error) => void

  constructor(opts: GraylogTransportOpts) {
    super({ objectMode: true })

    this.host = opts.host ?? 'bhs1.logs.ovh.com'
    this.port = opts.port ?? 12202
    this.protocol = opts.protocol ?? 'tls'
    this.staticMeta = opts.staticMeta ?? {}
    this.hostname = opts.hostname ?? os.hostname()
    this.facility = opts.facility ?? this.hostname
    this.maxQueueSize = opts.maxQueueSize ?? 1000
    this.waitForDrain = opts.waitForDrain === undefined ? true : Boolean(opts.waitForDrain)
    this.dropWhenFull = opts.dropWhenFull === undefined ? false : Boolean(opts.dropWhenFull)
    this.handleError =
      opts.onError ??
      ((error: Error, context?: Record<string, unknown>) => {
        console.error('Graylog transport error:', error.message, context || {})
      })
    this.onReady = opts.onReady

    // Establish initial connection unless explicitly disabled
    if (opts.autoConnect !== false) {
      this.connect()
        .then(() => {
          // Connection successful
        })
        .catch((err) => {
          this.handleError(err, { reason: 'Initial Graylog connection failed' })
          if (!this.initializationAttempted && this.onReady) {
            this.initializationAttempted = true
            this.onReady(false, err)
          }
          this.ready = false
        })
    }
  }

  // --- Public status methods ---

  isReady(): boolean {
    return this.ready
  }

  getQueueSize(): number {
    return this.messageQueue.length
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  getDroppedMessageCount(): number {
    return this.droppedMessageCount
  }

  getMaxQueueSize(): number {
    return this.maxQueueSize
  }

  // --- Writable implementation ---

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const gelfStr = formatGelfMessage(
      chunk,
      this.hostname,
      this.facility,
      this.staticMeta,
    )

    const socket = this.socket

    if (socket && !socket.destroyed) {
      // GELF over TCP requires null byte terminator
      const message = gelfStr + '\0'

      // Bun optimization: Use Bun.write() if available (faster than socket.write)
      if (isBun && (socket as any).write) {
        // Bun's write is synchronous and faster, but we still respect the API
        const success = socket.write(message)
        if (this.waitForDrain && !success) {
          socket.once('drain', callback)
        } else {
          callback()
        }
      } else {
        // Standard Node.js path
        const success = socket.write(message)
        if (this.waitForDrain && !success) {
          socket.once('drain', callback)
        } else {
          callback()
        }
      }
    } else {
      // Queue message if not connected - store with terminator
      const queueLen = this.messageQueue.length
      if (queueLen >= this.maxQueueSize) {
        if (this.dropWhenFull) {
          // Drop incoming message
          this.droppedMessageCount++
          if (this.droppedMessageCount % 100 === 1) {
            this.handleError(
              new Error('Graylog message dropped due to full queue'),
              {
                reason: 'Queue full, dropWhenFull=true',
                queueSize: this.maxQueueSize,
                droppedCount: this.droppedMessageCount,
              },
            )
          }
          callback()
          return
        }
        // Drop oldest to make room (FIFO) - shift is O(n) but rare in connected state
        this.messageQueue.shift()
        this.droppedMessageCount++
        if (this.droppedMessageCount % 100 === 1) {
          this.handleError(new Error('Graylog message queue overflow'), {
            reason: 'Queue at max capacity, dropping oldest messages',
            queueSize: this.maxQueueSize,
            droppedCount: this.droppedMessageCount,
          })
        }
      }

      this.messageQueue.push(gelfStr + '\0')
      this.connect().catch((err) => {
        this.handleError(err, {
          reason: 'Failed to connect while sending message',
        })
      })
      callback()
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end()
    }
    callback()
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy()
    }
    callback(error)
  }

  // --- Private methods ---

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket)
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = new Promise<net.Socket>((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        const timeoutError = new Error('Graylog connection timeout')
        try {
          // newSocket may not be assigned yet
          if (typeof newSocket !== 'undefined' && newSocket) newSocket.destroy()
        } catch (e) {}
        this.socket = null
        this.connectionPromise = null
        reject(timeoutError)
      }, 10000)

      const onConnect = () => {
        clearTimeout(connectionTimeout)
        this.socket = newSocket
        this.ready = true

        if (!this.initializationAttempted && this.onReady) {
          this.initializationAttempted = true
          this.onReady(true)
        }

        // Flush queued messages
        const messagesToFlush = [...this.messageQueue]
        this.messageQueue = []
        for (const msg of messagesToFlush) {
          if (this.socket && !this.socket.destroyed) {
            this.socket.write(msg)
          }
        }

        this.connectionPromise = null
        resolve(newSocket)
      }

      let newSocket: net.Socket
      if (this.protocol === 'tcp') {
        // Bun optimization: Use Bun.connect() if available (faster TCP connection)
        if (isBun && typeof (globalThis as any).Bun?.connect === 'function') {
          try {
            // Bun.connect returns a socket-like object compatible with Node's net.Socket
            const bunSocket = (globalThis as any).Bun.connect({
              hostname: this.host,
              port: this.port,
              socket: {
                data: () => {}, // no-op data handler
                open: (socket: any) => {
                  // Bun calls 'open' callback when connected
                  onConnect()
                },
                error: (socket: any, error: Error) => {
                  clearTimeout(connectionTimeout)
                  this.handleError(error, {
                    host: this.host,
                    port: this.port,
                    reason: 'TCP connection error (Bun)',
                  })
                  this.socket = null
                  this.connectionPromise = null
                  reject(error)
                },
                close: () => {
                  clearTimeout(connectionTimeout)
                  this.socket = null
                  if (this.connectionPromise) {
                    this.connectionPromise = null
                  }
                },
              },
            })
            newSocket = bunSocket as net.Socket
            // Set TCP optimizations on Bun socket if available
            if (typeof newSocket.setNoDelay === 'function') newSocket.setNoDelay(true)
            if (typeof newSocket.setKeepAlive === 'function') newSocket.setKeepAlive(true)
          } catch (bunError) {
            // Fallback to Node.js if Bun.connect fails
            newSocket = net.createConnection(
              { host: this.host, port: this.port },
              onConnect,
            )
            newSocket.setNoDelay(true)
            newSocket.setKeepAlive(true)
            newSocket.on('error', (err: Error) => {
              clearTimeout(connectionTimeout)
              this.handleError(err, {
                host: this.host,
                port: this.port,
                reason: 'TCP connection error',
              })
              this.socket = null
              this.connectionPromise = null
              reject(err)
            })
            newSocket.on('close', () => {
              clearTimeout(connectionTimeout)
              this.socket = null
              if (this.connectionPromise) {
                this.connectionPromise = null
              }
            })
          }
        } else {
          // Standard Node.js TCP connection
          newSocket = net.createConnection(
            { host: this.host, port: this.port },
            onConnect,
          )
          newSocket.setNoDelay(true)
          newSocket.setKeepAlive(true)
          newSocket.on('error', (err: Error) => {
            clearTimeout(connectionTimeout)
            this.handleError(err, {
              host: this.host,
              port: this.port,
              reason: 'TCP connection error',
            })
            this.socket = null
            this.connectionPromise = null
            reject(err)
          })
          newSocket.on('close', () => {
            clearTimeout(connectionTimeout)
            this.socket = null
            if (this.connectionPromise) {
              this.connectionPromise = null
            }
          })
        }
      } else {
        newSocket = tls.connect(
          { host: this.host, port: this.port, rejectUnauthorized: true },
          onConnect,
        )
        // OPTIMIZATIONS for TLS
        newSocket.setNoDelay(true)
        newSocket.setKeepAlive(true)

        newSocket.on('error', (err: Error) => {
          clearTimeout(connectionTimeout)
          this.handleError(err, {
            host: this.host,
            port: this.port,
            reason: 'TLS connection error',
          })
          this.socket = null
          this.connectionPromise = null
          reject(err)
        })

        newSocket.on('close', () => {
          clearTimeout(connectionTimeout)
          this.socket = null
          if (this.connectionPromise) {
            this.connectionPromise = null
          }
        })
      }
    })

    return this.connectionPromise
  }
}

/**
 * Factory function for creating a GraylogWritable transport.
 *
 * @param opts Options for configuring the Graylog transport.
 * @returns A GraylogWritable stream compatible with Pino's transport interface.
 */
export default function graylogTransport(
  opts: GraylogTransportOpts = {},
): GraylogWritable {
  return new GraylogWritable(opts)
}
