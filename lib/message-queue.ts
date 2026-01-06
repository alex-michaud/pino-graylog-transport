/**
 * Manages a message queue with configurable overflow behavior
 */
export class MessageQueue {
  private queue: string[] = []
  private droppedCount = 0
  private readonly maxSize: number
  private readonly dropWhenFull: boolean
  private readonly onDropped: (reason: string, count: number) => void

  constructor(opts: {
    maxSize: number
    dropWhenFull: boolean
    onDropped: (reason: string, count: number) => void
  }) {
    this.maxSize = opts.maxSize
    this.dropWhenFull = opts.dropWhenFull
    this.onDropped = opts.onDropped
  }

  /**
   * Add a message to the queue
   * @returns true if message was queued, false if dropped
   */
  enqueue(message: string): boolean {
    if (this.queue.length >= this.maxSize) {
      this.droppedCount++

      if (this.dropWhenFull) {
        // Drop the new message
        if (this.droppedCount % 100 === 1) {
          this.onDropped('Queue full, dropWhenFull=true', this.droppedCount)
        }
        return false
      }

      // Drop oldest message to make room (FIFO)
      this.queue.shift()
      if (this.droppedCount % 100 === 1) {
        this.onDropped(
          'Queue at max capacity, dropping oldest messages',
          this.droppedCount,
        )
      }
    }

    this.queue.push(message)
    return true
  }

  /**
   * Get all messages and clear the queue
   */
  flush(): string[] {
    const messages = [...this.queue]
    this.queue = []
    return messages
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length
  }

  /**
   * Get total dropped message count
   */
  getDroppedCount(): number {
    return this.droppedCount
  }

  /**
   * Get max queue size
   */
  getMaxSize(): number {
    return this.maxSize
  }
}
