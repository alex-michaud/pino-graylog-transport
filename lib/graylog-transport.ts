import type net from 'node:net'
import os from 'node:os'
import { Writable } from 'node:stream'
import { FlushManager } from './flush-manager'
import { formatGelfMessage } from './gelf-formatter'
import { MessageQueue } from './message-queue'
import { SocketConnectionManager } from './socket-connection'
import type { ErrorHandler, PinoGraylogTransportOptions } from './types'
import { UdpClient } from './udp-client'

// Re-export types for convenience
export type { PinoGraylogTransportOptions } from './types'

/**
 * A Writable stream that sends logs to Graylog and exposes status methods.
 */
export class PinoGraylogTransport extends Writable {
  private socket: net.Socket | null = null
  private udpClient: UdpClient | null = null
  private connectionPromise: Promise<net.Socket> | null = null
  private messageQueue: MessageQueue
  private flushManager: FlushManager
  private initializationAttempted = false
  private ready = false
  private closing = false
  private readonly socketManager = new SocketConnectionManager()

  private readonly host: string
  private readonly port: number
  private readonly protocol: 'tcp' | 'tls' | 'udp'
  private readonly staticMeta: Record<string, unknown>
  private readonly hostname: string
  private readonly facility: string
  private readonly waitForDrain: boolean
  private readonly handleError: ErrorHandler
  private readonly onReady?: (success: boolean, error?: Error) => void

  constructor(opts: PinoGraylogTransportOptions) {
    super({ objectMode: true })

    this.host = opts.host ?? 'localhost'
    this.port = opts.port ?? 12201
    this.protocol = opts.protocol ?? 'tls'
    this.staticMeta = opts.staticMeta ?? {}
    this.hostname = opts.hostname ?? os.hostname()
    this.facility = opts.facility ?? this.hostname
    this.waitForDrain =
      opts.waitForDrain === undefined ? true : Boolean(opts.waitForDrain)

    // Initialize error handler
    this.handleError =
      opts.onError ??
      ((error: Error, context?: Record<string, unknown>) => {
        console.error('Graylog transport error:', error.message, context || {})
      })
    this.onReady = opts.onReady

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

    // Initialize flush manager
    this.flushManager = new FlushManager({
      getQueueSize: () => this.messageQueue.size(),
      isConnected: () => this.isConnected(),
      getSocket: () => this.socket,
      getConnectionPromise: () => this.connectionPromise,
      connect: () => this.connect(),
    })

    // Initialize based on protocol
    this.initializeConnection(opts.autoConnect)
  }

  // --- Public status methods ---

  /**
   * Returns true if the transport is ready to send messages.
   */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Returns the number of messages currently queued.
   */
  getQueueSize(): number {
    return this.messageQueue.size()
  }

  /**
   * Returns true if the transport is connected to Graylog.
   */
  isConnected(): boolean {
    if (this.protocol === 'udp') {
      return this.udpClient?.isReady() ?? false
    }
    return this.socket !== null && !this.socket.destroyed
  }

  /**
   * Returns the number of messages that have been dropped.
   */
  getDroppedMessageCount(): number {
    return this.messageQueue.getDroppedCount()
  }

  /**
   * Returns the maximum queue size.
   */
  getMaxQueueSize(): number {
    return this.messageQueue.getMaxSize()
  }

  /**
   * Returns the number of outstanding write operations that are either currently
   * in-flight or queued to be written.
   *
   * This value is computed as:
   *   pendingWrites + messageQueue.size()
   *
   * - `pendingWrites` counts socket writes that have been issued and are being
   *   tracked because a flush is in progress (i.e. one or more callers have
   *   requested a `flush()`); these represent write operations that have been
   *   handed to the socket but have not yet completed.
   * - `messageQueue.size()` counts messages that are still enqueued and have
   *   not yet been sent to the socket (for example, when the transport is not
   *   connected).
   *
   * When to call:
   * - Call this to observe how much work remains before the transport is
   *   fully flushed (useful for monitoring or graceful shutdown logic).
   * - Note that the number is a point-in-time snapshot and may change
   *   immediately after calling (concurrent writes or flushes can increase or
   *   decrease the returned value).
   *
   * Guarantees and caveats:
   * - The method is inexpensive and safe to call from application code.
   * - Because the value is not atomic with respect to async operations, it
   *   should be used for informational/decision-making purposes only; use
   *   `flush()` to actively wait for completion.
   */
  getPendingWriteCount(): number {
    return this.flushManager.getPendingWriteCount()
  }

  /**
   * Returns true if the stream is in the process of closing.
   */
  isClosing(): boolean {
    return this.closing
  }

  /**
   * Waits for all pending writes to complete and the queue to be flushed.
   * @param timeout Maximum time to wait in milliseconds (default: 5000)
   */
  async flush(timeout = 5000): Promise<void> {
    return this.flushManager.flush(timeout)
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

    // UDP: Send directly without null terminator (not required for UDP GELF)
    if (this.protocol === 'udp' && this.udpClient) {
      this.udpClient.send(gelfStr, callback)
      return
    }

    // TCP/TLS: Append null terminator as message delimiter
    const message = `${gelfStr}\0`

    const socket = this.socket
    if (socket && !socket.destroyed) {
      this.writeToSocket(socket, message, callback)
    } else {
      this.queueMessage(message, callback)
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.closing = true

    const finishClose = () => {
      if (this.socket && !this.socket.destroyed) {
        this.socket.end()
      }
      callback()
    }

    // Keep flushing until no more pending writes or queue items
    // This handles the case where new writes arrive during flush
    const maxRetries = 10
    const flushUntilDone = async (retries = 0): Promise<void> => {
      await this.flush()

      // Check if more writes came in during the flush
      if (this.getPendingWriteCount() > 0 && retries < maxRetries) {
        return flushUntilDone(retries + 1)
      }
    }

    flushUntilDone().finally(finishClose)
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy()
    }
    if (this.udpClient) {
      this.udpClient.close()
    }
    callback(error)
  }

  // --- Private methods ---

  private initializeConnection(autoConnect?: boolean): void {
    if (this.protocol === 'udp') {
      // UDP is connectionless - always initialize regardless of autoConnect
      this.udpClient = new UdpClient({
        host: this.host,
        port: this.port,
        onError: this.handleError,
      })
      this.udpClient.connect()
      this.ready = true
      this.initializationAttempted = true
      if (this.onReady) {
        this.onReady(true)
      }
    } else if (autoConnect !== false) {
      // TCP/TLS: Establish initial connection unless explicitly disabled
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

  private writeToSocket(
    socket: net.Socket,
    message: string,
    callback: (error?: Error | null) => void,
  ): void {
    let canContinue: boolean

    // Only track pending writes when flush is in progress (avoids overhead in normal operation)
    if (this.flushManager.trackWrite()) {
      canContinue = socket.write(message, () => {
        this.flushManager.writeComplete()
      })
    } else {
      canContinue = socket.write(message)
    }

    // Call callback immediately (fire-and-forget) unless waitForDrain is enabled
    // When socket.write() returns false, the internal buffer is full and we should wait for drain
    if (this.waitForDrain && !canContinue) {
      socket.once('drain', () => callback())
      return
    }
    callback()
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

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket)
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = new Promise<net.Socket>((resolve, reject) => {
      let cleanupFn: (() => void) | null = null

      const { socket, cleanup } = this.socketManager.createConnection({
        host: this.host,
        port: this.port,
        protocol: this.protocol,
        onConnect: () => {
          if (cleanupFn) cleanupFn()
          this.socket = socket
          this.ready = true

          if (!this.initializationAttempted && this.onReady) {
            this.initializationAttempted = true
            this.onReady(true)
          }

          // Flush queued messages
          this.flushQueuedMessages()

          this.connectionPromise = null
          resolve(socket)
        },
        onError: (error, context) => {
          if (cleanupFn) cleanupFn()
          this.handleError(error, context)
          this.socket = null
          this.connectionPromise = null
          reject(error)
        },
        onClose: () => {
          if (cleanupFn) cleanupFn()
          this.socket = null
          if (this.connectionPromise) {
            this.connectionPromise = null
          }
        },
      })

      cleanupFn = cleanup
    })

    return this.connectionPromise
  }

  private flushQueuedMessages(): void {
    const messagesToFlush = this.messageQueue.flush()
    for (const msg of messagesToFlush) {
      if (this.socket && !this.socket.destroyed) {
        if (this.flushManager.trackWrite()) {
          this.socket.write(msg, () => {
            this.flushManager.writeComplete()
          })
        } else {
          this.socket.write(msg)
        }
      }
    }
  }
}

/**
 * Factory function for creating a GraylogWritable transport.
 *
 * @param opts Options for configuring the Graylog transport.
 * @returns A GraylogWritable stream compatible with Pino's transport interface.
 */
export default function graylogTransport(
  opts: PinoGraylogTransportOptions = {},
): PinoGraylogTransport {
  return new PinoGraylogTransport(opts)
}
