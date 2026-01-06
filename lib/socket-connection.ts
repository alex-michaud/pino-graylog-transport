import net from 'node:net'
import tls from 'node:tls'

// Runtime detection: Check if running in Bun (which has faster APIs)
const isBun = typeof process.versions.bun !== 'undefined'

// Type definition for Bun globals (to avoid 'any' types)
interface BunGlobal {
  Bun?: {
    connect: (opts: unknown) => net.Socket
  }
}

export interface SocketConnectionOpts {
  host: string
  port: number
  protocol: 'tcp' | 'tls'
  onConnect: () => void
  onError: (error: Error, context: Record<string, unknown>) => void
  onClose: () => void
}

/**
 * Creates a socket connection (TCP, TLS, or Bun-optimized)
 */
export class SocketConnectionManager {
  createConnection(opts: SocketConnectionOpts): {
    socket: net.Socket
    cleanup: () => void
  } {
    const connectionTimeout = setTimeout(() => {
      const timeoutError = new Error('Graylog connection timeout')
      try {
        socket.destroy()
      } catch (_e) {}
      opts.onError(timeoutError, { reason: 'Connection timeout' })
    }, 10000)

    const cleanup = () => clearTimeout(connectionTimeout)

    let socket: net.Socket
    if (opts.protocol === 'tcp') {
      socket = this.createTcpConnection(opts, connectionTimeout)
    } else {
      socket = this.createTlsConnection(opts, connectionTimeout)
    }

    return { socket, cleanup }
  }

  private createTcpConnection(
    opts: SocketConnectionOpts,
    connectionTimeout: NodeJS.Timeout,
  ): net.Socket {
    // Bun optimization: Use Bun.connect() if available (faster TCP connection)
    if (
      isBun &&
      typeof (globalThis as unknown as BunGlobal).Bun?.connect === 'function'
    ) {
      return this.createBunConnection(opts, connectionTimeout)
    }
    return this.createNodeTcpConnection(opts, connectionTimeout)
  }

  private createBunConnection(
    opts: SocketConnectionOpts,
    connectionTimeout: NodeJS.Timeout,
  ): net.Socket {
    try {
      const bunSocket = (globalThis as unknown as BunGlobal).Bun?.connect({
        hostname: opts.host,
        port: opts.port,
        socket: {
          data: () => {},
          open: () => {
            clearTimeout(connectionTimeout)
            opts.onConnect()
          },
          error: (error: Error) => {
            clearTimeout(connectionTimeout)
            opts.onError(error, {
              host: opts.host,
              port: opts.port,
              reason: 'TCP connection error (Bun)',
            })
          },
          close: () => {
            clearTimeout(connectionTimeout)
            opts.onClose()
          },
        },
      })
      const socket = bunSocket as net.Socket
      if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true)
      if (typeof socket.setKeepAlive === 'function') socket.setKeepAlive(true)
      return socket
    } catch (_bunError) {
      // Fallback to Node.js if Bun.connect fails
      return this.createNodeTcpConnection(opts, connectionTimeout)
    }
  }

  private createNodeTcpConnection(
    opts: SocketConnectionOpts,
    connectionTimeout: NodeJS.Timeout,
  ): net.Socket {
    const socket = net.createConnection(
      { host: opts.host, port: opts.port },
      () => {
        clearTimeout(connectionTimeout)
        opts.onConnect()
      },
    )
    socket.setNoDelay(true)
    socket.setKeepAlive(true)
    this.attachSocketHandlers(socket, opts, connectionTimeout, 'TCP')
    return socket
  }

  private createTlsConnection(
    opts: SocketConnectionOpts,
    connectionTimeout: NodeJS.Timeout,
  ): net.Socket {
    const socket = tls.connect(
      { host: opts.host, port: opts.port, rejectUnauthorized: true },
      () => {
        clearTimeout(connectionTimeout)
        opts.onConnect()
      },
    )
    socket.setNoDelay(true)
    socket.setKeepAlive(true)
    this.attachSocketHandlers(socket, opts, connectionTimeout, 'TLS')
    return socket
  }

  private attachSocketHandlers(
    socket: net.Socket,
    opts: SocketConnectionOpts,
    connectionTimeout: NodeJS.Timeout,
    protocol: string,
  ): void {
    socket.on('error', (err: Error) => {
      clearTimeout(connectionTimeout)
      opts.onError(err, {
        host: opts.host,
        port: opts.port,
        reason: `${protocol} connection error`,
      })
    })

    socket.on('close', () => {
      clearTimeout(connectionTimeout)
      opts.onClose()
    })
  }
}
