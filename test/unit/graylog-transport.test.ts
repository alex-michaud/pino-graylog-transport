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
})
