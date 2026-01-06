import type net from 'node:net'
import os from 'node:os'
import { Writable } from 'node:stream'
import { formatGelfMessage } from './gelf-formatter'
import { MessageQueue } from './message-queue'
import { SocketConnectionManager } from './socket-connection'

export type GraylogTransportOpts = {
  // Connection configuration
  host?: string
  port?: number
  protocol?: 'tcp' | 'tls'
  // Static metadata sent with every log message (e.g., tokens, environment, tags)
  staticMeta?: Record<string, unknown>
  // Log metadata
  facility?: string
  hostname?: string
  // Callbacks
  onError?: (error: Error, context?: Record<string, unknown>) => void
  onReady?: (success: boolean, error?: Error) => void
  // Queue configuration
  maxQueueSize?: number
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
  private messageQueue: MessageQueue
  private initializationAttempted = false
  private ready = false
  private readonly socketManager = new SocketConnectionManager()

  private readonly host: string
  private readonly port: number
  private readonly protocol: 'tcp' | 'tls'
  private readonly staticMeta: Record<string, unknown>
  private readonly hostname: string
  private readonly facility: string
  private readonly waitForDrain: boolean
  private readonly handleError: (
    error: Error,
    context?: Record<string, unknown>,
  ) => void
  private readonly onReady?: (success: boolean, error?: Error) => void

  constructor(opts: GraylogTransportOpts) {
    super({ objectMode: true })

    this.host = opts.host ?? 'localhost'
    this.port = opts.port ?? 12201
    this.protocol = opts.protocol ?? 'tcp'
    this.staticMeta = opts.staticMeta ?? {}
    this.hostname = opts.hostname ?? os.hostname()
    this.facility = opts.facility ?? this.hostname
    this.waitForDrain =
      opts.waitForDrain === undefined ? true : Boolean(opts.waitForDrain)

    // Initialize message queue
    this.messageQueue = new MessageQueue({
      maxSize: opts.maxQueueSize ?? 1000,
      dropWhenFull: opts.dropWhenFull ?? false,
      onDropped: (reason, count) => {
        this.handleError(
          new Error(
            opts.dropWhenFull
              ? 'Graylog message dropped due to full queue'
              : 'Graylog message queue overflow',
          ),
          {
            reason,
            queueSize: this.messageQueue.getMaxSize(),
            droppedCount: count,
          },
        )
      },
    })

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
    return this.messageQueue.size()
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  getDroppedMessageCount(): number {
    return this.messageQueue.getDroppedCount()
  }

  getMaxQueueSize(): number {
    return this.messageQueue.getMaxSize()
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
    const message = `${gelfStr}\0`

    const socket = this.socket
    if (socket && !socket.destroyed) {
      this.writeToSocket(socket, message, callback)
    } else {
      this.queueMessage(message, callback)
    }
  }

  private writeToSocket(
    socket: net.Socket,
    message: string,
    callback: (error?: Error | null) => void,
  ): void {
    const success = socket.write(message)
    if (this.waitForDrain && !success) {
      socket.once('drain', callback)
    } else {
      callback()
    }
  }

  private queueMessage(
    message: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.messageQueue.enqueue(message)
    this.connect().catch((err) => {
      this.handleError(err, {
        reason: 'Failed to connect while sending message',
      })
    })
    callback()
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
      const { socket, cleanup } = this.socketManager.createConnection({
        host: this.host,
        port: this.port,
        protocol: this.protocol,
        onConnect: () => {
          cleanup()
          this.socket = socket
          this.ready = true

          if (!this.initializationAttempted && this.onReady) {
            this.initializationAttempted = true
            this.onReady(true)
          }

          // Flush queued messages
          const messagesToFlush = this.messageQueue.flush()
          for (const msg of messagesToFlush) {
            if (this.socket && !this.socket.destroyed) {
              this.socket.write(msg)
            }
          }

          this.connectionPromise = null
          resolve(socket)
        },
        onError: (error, context) => {
          cleanup()
          this.handleError(error, context)
          this.socket = null
          this.connectionPromise = null
          reject(error)
        },
        onClose: () => {
          cleanup()
          this.socket = null
          if (this.connectionPromise) {
            this.connectionPromise = null
          }
        },
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
