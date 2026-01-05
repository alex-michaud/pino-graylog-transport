import net from 'node:net'
import os from 'node:os'
import { Writable } from 'node:stream'
import tls from 'node:tls'
import { formatGelfMessage } from './gelf-formatter'

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
    this.handleError =
      opts.onError ??
      ((error: Error, context?: Record<string, unknown>) => {
        console.error('Graylog transport error:', error.message, context || {})
      })
    this.onReady = opts.onReady

    // Establish initial connection
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
    const messageStr = formatGelfMessage(
      chunk,
      this.hostname,
      this.facility,
      this.staticMeta,
    )

    // GELF over TCP requires null byte terminator
    const messageWithTerminator = messageStr + '\0'

    if (this.socket && !this.socket.destroyed) {
      if (this.socket.write(messageWithTerminator)) {
        callback()
      } else {
        this.socket.once('drain', callback)
      }
    } else {
      // Queue message if not connected
      if (this.messageQueue.length >= this.maxQueueSize) {
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

      this.messageQueue.push(messageWithTerminator)
      this.connect().catch((err) => {
        this.handleError(err, { reason: 'Failed to connect while sending message' })
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
        newSocket.destroy()
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
        newSocket = net.createConnection(
          { host: this.host, port: this.port },
          onConnect,
        )
      } else {
        newSocket = tls.connect(
          { host: this.host, port: this.port, rejectUnauthorized: true },
          onConnect,
        )
      }

      // OPTIMIZATIONS
      newSocket.setNoDelay(true)
      newSocket.setKeepAlive(true)

      newSocket.on('error', (err: Error) => {
        clearTimeout(connectionTimeout)
        this.handleError(err, {
          host: this.host,
          port: this.port,
          reason: `${this.protocol.toUpperCase()} connection error`,
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
