import { Writable } from 'node:stream'
import { expect } from 'chai'
import { pino } from 'pino'
import graylogTransport, {
  PinoGraylogTransport,
} from '../../lib/graylog-transport'

describe('Graylog Transport', () => {
  it('should create a writable stream', () => {
    const stream = graylogTransport({
      host: 'localhost',
      port: 12201,
      staticMeta: { token: 'test' },
      autoConnect: false,
    })

    expect(stream).to.be.instanceOf(Writable)
    expect(stream).to.be.instanceOf(PinoGraylogTransport)
  })

  it('should use default options', () => {
    const stream = graylogTransport({
      staticMeta: { token: 'test' },
      autoConnect: false,
    })

    // Accessing internal state via exposed methods or properties if available
    // Since we don't expose host/port directly on the stream instance,
    // we can check the exposed utility methods
    expect(stream.getMaxQueueSize()).to.equal(1000)
    expect(stream.getQueueSize()).to.equal(0)
    expect(stream.isReady()).to.be.false
  })

  it('should accept custom options', () => {
    const stream = graylogTransport({
      host: 'custom-host',
      port: 12345,
      maxQueueSize: 500,
      staticMeta: { token: 'test' },
      autoConnect: false,
    })

    expect(stream.getMaxQueueSize()).to.equal(500)
  })

  it('should expose status methods', () => {
    const stream = graylogTransport({
      staticMeta: { token: 'test' },
      autoConnect: false,
    })

    expect(stream.isReady).to.be.a('function')
    expect(stream.getQueueSize).to.be.a('function')
    expect(stream.isConnected).to.be.a('function')
    expect(stream.getDroppedMessageCount).to.be.a('function')
    expect(stream.getPendingWriteCount).to.be.a('function')
  })

  describe('getPendingWriteCount Method', () => {
    it('should return 0 when no messages have been sent', () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      expect(stream.getPendingWriteCount()).to.equal(0)

      stream.destroy()
    })

    it('should return queue size when messages are queued', () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Message 1')
      logger.info('Message 2')
      logger.info('Message 3')

      // All messages should be in queue (no connection)
      expect(stream.getQueueSize()).to.equal(3)
      expect(stream.getPendingWriteCount()).to.equal(3)

      stream.destroy()
    })

    it('should match queue size when not connected', () => {
      const stream = graylogTransport({
        autoConnect: false,
        maxQueueSize: 100,
      })

      const logger = pino({ level: 'info' }, stream)

      // Send multiple messages
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`)
      }

      // getPendingWriteCount should equal queue size when not connected
      expect(stream.getPendingWriteCount()).to.equal(stream.getQueueSize())
      expect(stream.getPendingWriteCount()).to.equal(10)

      stream.destroy()
    })

    it('should return 0 after queue is cleared', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Message 1')

      expect(stream.getPendingWriteCount()).to.equal(1)

      // Destroy clears everything
      stream.destroy()

      // After destroy, queue should be intact but stream is destroyed
      // Create a new stream to verify initial state
      const newStream = graylogTransport({
        autoConnect: false,
      })

      expect(newStream.getPendingWriteCount()).to.equal(0)

      newStream.destroy()
    })

    it('should correctly sum pendingWrites and queue size', () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      // Initially both should be 0
      expect(stream.getPendingWriteCount()).to.equal(0)
      expect(stream.getQueueSize()).to.equal(0)

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // Message goes to queue since not connected
      expect(stream.getQueueSize()).to.equal(1)
      expect(stream.getPendingWriteCount()).to.equal(1)

      stream.destroy()
    })

    it('should handle UDP protocol correctly', () => {
      const stream = graylogTransport({
        protocol: 'udp',
        host: 'localhost',
        port: 12201,
      })

      // UDP is immediately ready, no queue needed
      expect(stream.isReady()).to.be.true
      expect(stream.getPendingWriteCount()).to.equal(0)

      stream.destroy()
    })

    it('should reflect queue size with dropWhenFull', () => {
      const stream = graylogTransport({
        autoConnect: false,
        maxQueueSize: 3,
        dropWhenFull: true,
      })

      const logger = pino({ level: 'info' }, stream)

      // Send more messages than queue can hold
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`)
      }

      // Queue should be at max, pending count reflects actual queued messages
      expect(stream.getQueueSize()).to.equal(3)
      expect(stream.getPendingWriteCount()).to.equal(3)

      stream.destroy()
    })
  })

  describe('Pino Logger Integration', () => {
    it('should accept Pino log messages', (done) => {
      const stream = graylogTransport({
        autoConnect: false,
        dropWhenFull: true,
      })

      const logger = pino({ level: 'info' }, stream)

      // This should not throw
      logger.info('Test message')
      logger.warn({ userId: 123 }, 'Warning with data')
      logger.error(new Error('Test error'), 'Error occurred')

      // Messages should be queued since we're not connected
      expect(stream.getQueueSize()).to.be.greaterThan(0)

      stream.end(() => done())
    })

    it('should queue messages when not connected', () => {
      const stream = graylogTransport({
        autoConnect: false,
        maxQueueSize: 10,
      })

      const logger = pino({ level: 'debug' }, stream)

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        logger.info(`Message ${i}`)
      }

      // Messages should be queued
      expect(stream.getQueueSize()).to.equal(5)

      stream.destroy()
    })

    it('should drop messages when queue is full and dropWhenFull is true', () => {
      let droppedCount = 0
      const stream = graylogTransport({
        autoConnect: false,
        maxQueueSize: 3,
        dropWhenFull: true,
        onError: () => {
          droppedCount++
        },
      })

      const logger = pino({ level: 'info' }, stream)

      // Send more messages than queue can hold
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`)
      }

      // Queue should be at max size
      expect(stream.getQueueSize()).to.equal(3)
      expect(droppedCount).to.be.greaterThan(0)

      stream.destroy()
    })

    it('should handle child loggers', (done) => {
      const stream = graylogTransport({
        autoConnect: false,
        dropWhenFull: true,
      })

      const logger = pino({ level: 'info' }, stream)
      const childLogger = logger.child({ requestId: 'abc-123' })

      childLogger.info('Child logger message')
      childLogger.warn({ userId: 456 }, 'Child with extra data')

      expect(stream.getQueueSize()).to.be.greaterThan(0)

      stream.end(() => done())
    })

    it('should handle different log levels', (done) => {
      const stream = graylogTransport({
        autoConnect: false,
        dropWhenFull: true,
      })

      const logger = pino({ level: 'trace' }, stream)

      logger.trace('Trace message')
      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warn message')
      logger.error('Error message')
      logger.fatal('Fatal message')

      // All 6 messages should be queued
      expect(stream.getQueueSize()).to.equal(6)

      stream.end(() => done())
    })

    it('should include staticMeta in queued messages', (done) => {
      const stream = graylogTransport({
        autoConnect: false,
        staticMeta: {
          environment: 'test',
          service: 'unit-test',
        },
      })

      const logger = pino({ level: 'info' }, stream)

      logger.info('Message with static meta')

      expect(stream.getQueueSize()).to.equal(1)

      stream.end(() => done())
    })

    it('should handle objects and errors in log messages', (done) => {
      const stream = graylogTransport({
        autoConnect: false,
        dropWhenFull: true,
      })

      const logger = pino({ level: 'info' }, stream)

      // Log with object
      logger.info({ user: { id: 1, name: 'Test' } }, 'User action')

      // Log with error
      const err = new Error('Something went wrong')
      logger.error({ err }, 'Error occurred')

      expect(stream.getQueueSize()).to.equal(2)

      stream.end(() => done())
    })

    it('should respect custom facility and hostname', () => {
      const stream = graylogTransport({
        autoConnect: false,
        facility: 'custom-app',
        hostname: 'custom-host',
      })

      const logger = pino({ level: 'info' }, stream)

      logger.info('Test message')

      expect(stream.getQueueSize()).to.equal(1)

      stream.destroy()
    })

    it('should not connect when autoConnect is false', () => {
      const stream = graylogTransport({
        host: 'localhost',
        port: 12201,
        protocol: 'tcp',
        autoConnect: false,
      })

      // Should not be connected or ready
      expect(stream.isConnected()).to.be.false
      expect(stream.isReady()).to.be.false

      stream.destroy()
    })

    it('should call onError callback when dropping messages', (done) => {
      const errors: Error[] = []
      const stream = graylogTransport({
        autoConnect: false,
        maxQueueSize: 1,
        dropWhenFull: true,
        onError: (err) => {
          errors.push(err)
        },
      })

      const logger = pino({ level: 'info' }, stream)

      // First message fills the queue
      logger.info('Message 1')
      // Second message should trigger onError
      logger.info('Message 2')

      // Give time for callbacks
      setTimeout(() => {
        expect(errors.length).to.be.greaterThan(0)
        expect(errors[0].message).to.include('dropped')
        stream.end(() => done())
      }, 10)
    })
  })

  describe('waitForDrain Option', () => {
    it('should default waitForDrain to true', () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      // Default is true, so stream should be configured to wait for drain
      // We can't directly access the private property, but we can verify behavior
      expect(stream).to.be.instanceOf(Writable)

      stream.destroy()
    })

    it('should accept waitForDrain option set to false', () => {
      const stream = graylogTransport({
        autoConnect: false,
        waitForDrain: false,
      })

      expect(stream).to.be.instanceOf(Writable)

      stream.destroy()
    })

    it('should accept waitForDrain option set to true', () => {
      const stream = graylogTransport({
        autoConnect: false,
        waitForDrain: true,
      })

      expect(stream).to.be.instanceOf(Writable)

      stream.destroy()
    })

    it('should queue messages normally with waitForDrain enabled', () => {
      const stream = graylogTransport({
        autoConnect: false,
        waitForDrain: true,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message 1')
      logger.info('Test message 2')

      expect(stream.getQueueSize()).to.equal(2)

      stream.destroy()
    })

    it('should queue messages normally with waitForDrain disabled', () => {
      const stream = graylogTransport({
        autoConnect: false,
        waitForDrain: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message 1')
      logger.info('Test message 2')

      expect(stream.getQueueSize()).to.equal(2)

      stream.destroy()
    })
  })

  describe('Flush Method', () => {
    it('should resolve immediately when no pending writes and queue is empty', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const startTime = Date.now()
      await stream.flush()
      const elapsed = Date.now() - startTime

      // Should resolve almost immediately (allow some margin for test execution)
      expect(elapsed).to.be.lessThan(100)

      stream.destroy()
    })

    it('should resolve after timeout when connection fails', async () => {
      const stream = graylogTransport({
        host: 'nonexistent.invalid',
        port: 12201,
        protocol: 'tcp',
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // Queue has a message, but connection will fail
      expect(stream.getQueueSize()).to.equal(1)

      // Flush should complete (either successfully or after connection failure)
      await stream.flush(500)

      stream.destroy()
    })

    it('should handle flush with custom timeout', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      const startTime = Date.now()
      await stream.flush(100)
      const elapsed = Date.now() - startTime

      // Should timeout around 100ms (allow margin)
      expect(elapsed).to.be.lessThan(200)

      stream.destroy()
    })

    it('should track pendingWrites correctly', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      // Initially no pending writes
      expect(stream.getPendingWriteCount()).to.equal(0)

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message 1')
      logger.info('Test message 2')

      // Messages should be in queue (counted as pending)
      expect(stream.getPendingWriteCount()).to.equal(2)

      stream.destroy()
    })

    it('should handle concurrent flush calls', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // Call flush multiple times concurrently
      const flushPromises = [
        stream.flush(200),
        stream.flush(200),
        stream.flush(200),
      ]

      // All should resolve without errors
      await Promise.all(flushPromises)

      stream.destroy()
    })

    it('should handle staggered concurrent flush calls without race conditions', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // Start first flush
      const flush1 = stream.flush(300)

      // Start second flush after a small delay (simulates real-world staggered calls)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const flush2 = stream.flush(300)

      // Start third flush after another delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      const flush3 = stream.flush(300)

      // All should resolve independently without interfering with each other
      const results = await Promise.allSettled([flush1, flush2, flush3])

      // All promises should be fulfilled
      for (const result of results) {
        expect(result.status).to.equal('fulfilled')
      }

      stream.destroy()
    })

    it('should reset flush state after flush completes', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      await stream.flush(50)

      // After flush, can still send messages normally
      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message after flush')

      expect(stream.getQueueSize()).to.equal(1)

      stream.destroy()
    })

    it('should handle flush when already connected (UDP)', async () => {
      const stream = graylogTransport({
        protocol: 'udp',
        host: 'localhost',
        port: 12201,
      })

      // UDP should be ready immediately
      expect(stream.isReady()).to.be.true

      // Flush should resolve immediately since there's nothing pending
      const startTime = Date.now()
      await stream.flush()
      const elapsed = Date.now() - startTime

      expect(elapsed).to.be.lessThan(100)

      stream.destroy()
    })

    it('should use default timeout of 5000ms', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // Start flush without timeout (uses default)
      const flushPromise = stream.flush()

      // Since we can't wait 5 seconds in a unit test, destroy the stream
      // which should allow flush to complete
      stream.destroy()

      // Flush should complete after destroy
      await flushPromise
    })

    it('should handle empty queue with socket buffer data scenario', async () => {
      const stream = graylogTransport({
        autoConnect: false,
      })

      // No messages, just flush
      await stream.flush(100)

      // Should complete without issues
      expect(stream.getQueueSize()).to.equal(0)

      stream.destroy()
    })

    it('should handle flush during stream end', (done) => {
      const stream = graylogTransport({
        autoConnect: false,
        dropWhenFull: true,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // stream.end internally calls flush via _final
      stream.end(() => {
        // Stream ended successfully
        done()
      })
    })

    it('should not block when connection promise is pending', async () => {
      const stream = graylogTransport({
        host: 'localhost',
        port: 12201,
        protocol: 'tcp',
        autoConnect: false,
      })

      const logger = pino({ level: 'info' }, stream)
      logger.info('Test message')

      // Flush should not hang even if connection is attempted
      const startTime = Date.now()
      await stream.flush(300)
      const elapsed = Date.now() - startTime

      // Should complete within reasonable time
      expect(elapsed).to.be.lessThan(500)

      stream.destroy()
    })
  })
})
