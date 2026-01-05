import { expect } from 'chai'
import graylogTransport from '../../lib/graylog-transport'
import { Writable } from 'stream'

describe('Graylog Transport', () => {
  it('should create a writable stream', () => {
    const stream = graylogTransport({
      host: 'localhost',
      port: 12201,
      staticMeta: { token: 'test' }
    })

    expect(stream).to.be.instanceOf(Writable)
  })

  it('should use default options', () => {
    const stream = graylogTransport({
      staticMeta: { token: 'test' }
    }) as any

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
      staticMeta: { token: 'test' }
    }) as any

    expect(stream.getMaxQueueSize()).to.equal(500)
  })

  it('should expose status methods', () => {
    const stream = graylogTransport({
      staticMeta: { token: 'test' }
    }) as any

    expect(stream.isReady).to.be.a('function')
    expect(stream.getQueueSize).to.be.a('function')
    expect(stream.isConnected).to.be.a('function')
    expect(stream.getDroppedMessageCount).to.be.a('function')
  })
})

