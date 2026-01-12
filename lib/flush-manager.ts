import type net from 'node:net'

/**
 * Callback type for flush resolver functions.
 */
type FlushResolver = () => void

/**
 * Options for creating a FlushManager instance.
 */
export type FlushManagerOptions = {
  /** Function to get the current message queue size */
  getQueueSize: () => number
  /** Function to check if the socket is connected */
  isConnected: () => boolean
  /** Function to get the current socket (may be null) */
  getSocket: () => net.Socket | null
  /** Function to get the current connection promise (may be null) */
  getConnectionPromise: () => Promise<net.Socket> | null
  /** Function to attempt a connection */
  connect: () => Promise<net.Socket>
}

/**
 * Manages flush operations for the transport.
 *
 * This class encapsulates all the logic for:
 * - Tracking pending writes (in-flight socket writes)
 * - Managing flush reference counts for concurrent flush operations
 * - Resolving flush promises when all pending work is complete
 *
 * The flush mechanism is designed to be efficient: write tracking is only
 * enabled when at least one flush operation is in progress.
 */
export class FlushManager {
  private pendingWrites = 0
  private flushCount = 0
  private drainResolvers: FlushResolver[] = []
  private readonly opts: FlushManagerOptions

  constructor(opts: FlushManagerOptions) {
    this.opts = opts
  }

  /**
   * Returns the number of in-flight socket writes being tracked.
   * This only includes writes that occurred while a flush was in progress.
   */
  getPendingWrites(): number {
    return this.pendingWrites
  }

  /**
   * Returns the total number of outstanding write operations.
   * This includes both in-flight socket writes and queued messages.
   */
  getPendingWriteCount(): number {
    return this.pendingWrites + this.opts.getQueueSize()
  }

  /**
   * Returns true if at least one flush operation is currently in progress.
   */
  isFlushInProgress(): boolean {
    return this.flushCount > 0
  }

  /**
   * Called before a write operation to increment the pending write counter.
   * Only increments if a flush is in progress.
   *
   * @returns true if the write is being tracked, false otherwise
   */
  trackWrite(): boolean {
    if (this.flushCount > 0) {
      this.pendingWrites++
      return true
    }
    return false
  }

  /**
   * Called after a write operation completes to decrement the pending write counter.
   * Also checks if all pending work is complete and resolves any waiting flush promises.
   */
  writeComplete(): void {
    this.pendingWrites--
    this.checkDrain()
  }

  /**
   * Waits for all pending writes to complete and the queue to be flushed.
   *
   * @param timeout Maximum time to wait in milliseconds (default: 5000)
   * @returns Promise that resolves when flush is complete or timeout is reached
   */
  async flush(timeout = 5000): Promise<void> {
    this.flushCount++

    const decrementFlushCount = () => {
      this.flushCount = Math.max(0, this.flushCount - 1)
    }

    // Wait for any pending connection
    const connectionPromise = this.opts.getConnectionPromise()
    if (connectionPromise) {
      try {
        await connectionPromise
      } catch {
        decrementFlushCount()
        return
      }
    }

    // If queue has items but no socket, try to connect
    if (this.opts.getQueueSize() > 0 && !this.opts.isConnected()) {
      try {
        await this.opts.connect()
      } catch {
        decrementFlushCount()
        return
      }
    }

    // If nothing pending, we're done
    if (this.pendingWrites === 0 && this.opts.getQueueSize() === 0) {
      // Wait for socket buffer to drain
      const socket = this.opts.getSocket()
      if (socket && socket.writableLength > 0) {
        await this.waitForSocketDrain(socket, timeout, decrementFlushCount)
        return
      }
      decrementFlushCount()
      return
    }

    return new Promise<void>((resolve) => {
      let resolved = false

      const doResolve = () => {
        if (resolved) return
        resolved = true
        decrementFlushCount()
        clearTimeout(timeoutId)
        const idx = this.drainResolvers.indexOf(doResolve)
        if (idx !== -1) {
          this.drainResolvers.splice(idx, 1)
        }
        resolve()
      }

      const timeoutId = setTimeout(doResolve, timeout)

      this.drainResolvers.push(doResolve)
      this.checkDrain()
    })
  }

  /**
   * Waits for a socket to drain with a timeout.
   */
  private async waitForSocketDrain(
    socket: net.Socket,
    timeout: number,
    onComplete: () => void,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let resolved = false
      const doResolve = () => {
        if (resolved) return
        resolved = true
        clearTimeout(drainTimeout)
        socket.removeListener('drain', doResolve)
        socket.removeListener('error', doResolve)
        socket.removeListener('close', doResolve)
        onComplete()
        resolve()
      }
      const drainTimeout = setTimeout(doResolve, timeout)
      socket.once('drain', doResolve)
      socket.once('error', doResolve)
      socket.once('close', doResolve)
    })
  }

  /**
   * Internal helper that resolves all pending flush promises when both
   * pendingWrites and the message queue are empty.
   *
   * Called after write callbacks decrement the pendingWrites counter or
   * after queued messages are flushed.
   */
  checkDrain(): void {
    if (this.pendingWrites === 0 && this.opts.getQueueSize() === 0) {
      const resolvers = this.drainResolvers.splice(0)
      for (const resolve of resolvers) {
        resolve()
      }
    }
  }
}
