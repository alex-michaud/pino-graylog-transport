import dgram from 'node:dgram'

// Runtime detection: Check if running in Bun
const isBun = typeof process.versions.bun !== 'undefined'

// Type definitions for Bun's UDP API
interface BunUdpSocket {
  send(data: Uint8Array, port: number, host: string): number
  stop(): void
}

interface BunGlobal {
  Bun?: {
    udpSocket: (opts: {
      socket: {
        data?: (
          socket: BunUdpSocket,
          buf: Uint8Array,
          port: number,
          addr: string,
        ) => void
        error?: (socket: BunUdpSocket, error: Error) => void
        drain?: (socket: BunUdpSocket) => void
      }
    }) => Promise<BunUdpSocket>
  }
}

export interface UdpClientOpts {
  host: string
  port: number
  onError?: (error: Error, context?: Record<string, unknown>) => void
}

/**
 * UDP client for sending GELF messages to Graylog.
 * UDP is connectionless and fire-and-forget - no delivery guarantee.
 *
 * Supports both Node.js (dgram) and Bun (Bun.udpSocket) runtimes.
 * Bun's UDP implementation is faster and more efficient.
 */
export class UdpClient {
  private nodeSocket: dgram.Socket | null = null
  private bunSocket: BunUdpSocket | null = null
  private readonly host: string
  private readonly port: number
  private readonly handleError: (
    error: Error,
    context?: Record<string, unknown>,
  ) => void

  constructor(opts: UdpClientOpts) {
    this.host = opts.host
    this.port = opts.port
    this.handleError =
      opts.onError ??
      ((error, context) => {
        console.error('UDP client error:', error.message, context || {})
      })
  }

  /**
   * Initialize the UDP socket.
   * Uses Bun.udpSocket() if running in Bun, otherwise Node's dgram.
   */
  connect(): void {
    if (this.nodeSocket || this.bunSocket) return

    if (isBun && (globalThis as unknown as BunGlobal).Bun?.udpSocket) {
      this.connectBun()
    } else {
      this.connectNode()
    }
  }

  private connectNode(): void {
    this.nodeSocket = dgram.createSocket('udp4')

    this.nodeSocket.on('error', (err) => {
      this.handleError(err, {
        host: this.host,
        port: this.port,
        reason: 'UDP socket error',
      })
    })
  }

  private connectBun(): void {
    const Bun = (globalThis as unknown as BunGlobal).Bun
    if (!Bun?.udpSocket) return

    // Bun's udpSocket is async, but we handle it gracefully
    Bun.udpSocket({
      socket: {
        error: (_socket, error) => {
          this.handleError(error, {
            host: this.host,
            port: this.port,
            reason: 'UDP socket error (Bun)',
          })
        },
      },
    })
      .then((socket) => {
        this.bunSocket = socket
      })
      .catch((err) => {
        this.handleError(err, {
          host: this.host,
          port: this.port,
          reason: 'Failed to create Bun UDP socket',
        })
        // Fallback to Node.js dgram
        this.connectNode()
      })
  }

  /**
   * Send a message via UDP.
   * UDP is fire-and-forget - no guarantee of delivery.
   */
  send(message: string, callback?: (error?: Error | null) => void): void {
    if (!this.nodeSocket && !this.bunSocket) {
      this.connect()
    }

    const buffer = Buffer.from(message)

    // GELF over UDP has a max payload size of 8192 bytes (uncompressed)
    if (buffer.length > 8192) {
      this.handleError(
        new Error(
          `GELF UDP message exceeds 8192 bytes (${buffer.length}). Message may be truncated.`,
        ),
        { messageSize: buffer.length },
      )
    }

    // Use Bun socket if available
    if (this.bunSocket) {
      try {
        this.bunSocket.send(buffer, this.port, this.host)
        callback?.()
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.handleError(error, {
          host: this.host,
          port: this.port,
          reason: 'UDP send error (Bun)',
        })
        callback?.(error)
      }
      return
    }

    // Fallback to Node.js dgram
    this.nodeSocket?.send(
      buffer,
      0,
      buffer.length,
      this.port,
      this.host,
      (err) => {
        if (err) {
          this.handleError(err, {
            host: this.host,
            port: this.port,
            reason: 'UDP send error',
          })
        }
        callback?.(err)
      },
    )
  }

  /**
   * Check if the UDP socket is ready.
   * UDP is always "ready" since it's connectionless.
   */
  isReady(): boolean {
    return this.nodeSocket !== null || this.bunSocket !== null
  }

  /**
   * Close the UDP socket.
   */
  close(): void {
    if (this.nodeSocket) {
      this.nodeSocket.close()
      this.nodeSocket = null
    }
    if (this.bunSocket) {
      this.bunSocket.stop()
      this.bunSocket = null
    }
  }
}
