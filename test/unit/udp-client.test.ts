import dgram from 'node:dgram'
import { expect } from 'chai'
import { UdpClient } from '../../lib/udp-client'

describe('UDP Client', function () {
  // Set timeout for all tests in this suite
  this.timeout(5000)

  let client: UdpClient | null = null
  let mockServer: dgram.Socket | null = null
  const testPort = 12301 // Use a different port to avoid conflicts
  const testHost = 'localhost'

  afterEach((done) => {
    // Clean up client
    if (client) {
      client.close()
      client = null
    }

    // Clean up mock server
    if (mockServer) {
      try {
        mockServer.close(() => {
          mockServer = null
          // Small delay to allow socket cleanup
          setTimeout(done, 10)
        })
      } catch {
        mockServer = null
        done()
      }
    } else {
      done()
    }
  })

  describe('Initialization', () => {
    it('should create a UDP client instance', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      expect(client).to.be.instanceOf(UdpClient)
    })

    it('should not be ready before connect()', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      expect(client.isReady()).to.be.false
    })

    it('should be ready after connect()', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()
      expect(client.isReady()).to.be.true
    })

    it('should not create duplicate sockets on multiple connect() calls', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()
      expect(client.isReady()).to.be.true

      // Second connect should be no-op
      client.connect()
      expect(client.isReady()).to.be.true
    })

    it('should accept custom error handler', (done) => {
      let testCompleted = false

      const completeTest = () => {
        if (!testCompleted) {
          testCompleted = true
          done()
        }
      }

      client = new UdpClient({
        host: testHost,
        port: testPort,
        onError: (error, context) => {
          expect(error).to.be.instanceOf(Error)
          expect(context).to.have.property('host', testHost)
        },
      })

      client.connect()
      expect(client.isReady()).to.be.true

      // UDP error handling is best-effort, just verify the client works
      // and complete the test after a short delay
      setTimeout(completeTest, 50)
    })
  })

  describe('Message Sending', () => {
    beforeEach((done) => {
      // Create a mock UDP server to receive messages
      mockServer = dgram.createSocket('udp4')
      mockServer.bind(testPort, testHost, () => {
        done()
      })
    })

    it('should send a simple message', (done) => {
      const testMessage = 'Hello UDP!'

      mockServer?.once('message', (msg) => {
        expect(msg.toString()).to.equal(testMessage)
        done()
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.send(testMessage)
    })

    it('should send multiple messages', (done) => {
      const messages = ['Message 1', 'Message 2', 'Message 3']
      const received: string[] = []

      mockServer?.on('message', (msg) => {
        received.push(msg.toString())
        if (received.length === messages.length) {
          // UDP doesn't guarantee order, so use members (not deep.equal)
          expect(received).to.have.members(messages)
          done()
        }
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      messages.forEach((msg) => {
        client?.send(msg)
      })
    })

    it('should call callback after sending', (done) => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.send('test', (error) => {
        // Node.js dgram passes null on success, not undefined
        expect(error).to.be.null
        done()
      })
    })

    it('should auto-connect on first send if not connected', (done) => {
      const testMessage = 'Auto-connect test'

      mockServer?.once('message', (msg) => {
        expect(msg.toString()).to.equal(testMessage)
        expect(client?.isReady()).to.be.true
        done()
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      // Don't call connect() - should auto-connect
      expect(client.isReady()).to.be.false
      client.send(testMessage)
    })
  })

  describe('Size Limit Validation', () => {
    beforeEach((done) => {
      mockServer = dgram.createSocket('udp4')
      mockServer.bind(testPort, testHost, () => {
        done()
      })
    })

    it('should send messages under 8192 bytes', (done) => {
      const message = 'x'.repeat(8000) // Under limit
      let messageReceived = false
      let callbackCalled = false

      const checkComplete = () => {
        if (messageReceived && callbackCalled) {
          done()
        }
      }

      mockServer?.once('message', (msg) => {
        expect(msg.length).to.equal(8000)
        messageReceived = true
        checkComplete()
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.send(message, (error) => {
        expect(error).to.be.null
        callbackCalled = true
        checkComplete()
      })
    })

    it('should send messages exactly 8192 bytes', (done) => {
      const message = 'x'.repeat(8192) // Exactly at limit
      let messageReceived = false
      let callbackCalled = false

      const checkComplete = () => {
        if (messageReceived && callbackCalled) {
          done()
        }
      }

      mockServer?.once('message', (msg) => {
        expect(msg.length).to.equal(8192)
        messageReceived = true
        checkComplete()
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.send(message, (error) => {
        expect(error).to.be.null
        callbackCalled = true
        checkComplete()
      })
    })

    it('should reject messages over 8192 bytes', (done) => {
      const message = 'x'.repeat(8193) // Over limit
      let errorHandlerCalled = false

      client = new UdpClient({
        host: testHost,
        port: testPort,
        onError: (error, context) => {
          errorHandlerCalled = true
          expect(error.message).to.include('exceeds 8192 bytes')
          expect(context).to.have.property('messageSize', 8193)
          expect(context).to.have.property('maxSize', 8192)
        },
      })

      client.send(message, (error) => {
        expect(error).to.be.instanceOf(Error)
        expect(error?.message).to.include('exceeds 8192 bytes')
        expect(errorHandlerCalled).to.be.true

        // Verify message was NOT sent
        setTimeout(() => {
          done()
        }, 50)
      })

      // Ensure no message is received
      mockServer?.once('message', () => {
        done(new Error('Should not have received oversized message'))
      })
    })

    it('should provide helpful error message for oversized messages', (done) => {
      const message = 'x'.repeat(10000)

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.send(message, (error) => {
        expect(error).to.be.instanceOf(Error)
        expect(error?.message).to.include('Message rejected')
        expect(error?.message).to.include('TCP/TLS')
        done()
      })
    })
  })

  describe('Resource Cleanup', () => {
    it('should close the socket', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()
      expect(client.isReady()).to.be.true

      client.close()
      expect(client.isReady()).to.be.false
    })

    it('should allow re-initialization after close', (done) => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()
      expect(client.isReady()).to.be.true

      client.close()
      expect(client.isReady()).to.be.false

      // Re-initialize
      client.connect()
      expect(client.isReady()).to.be.true

      done()
    })

    it('should not throw when closing an uninitialized client', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      expect(() => client?.close()).to.not.throw()
    })

    it('should not throw when closing multiple times', () => {
      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()
      client.close()

      expect(() => client?.close()).to.not.throw()
    })
  })

  describe('Race Condition Handling', () => {
    beforeEach((done) => {
      mockServer = dgram.createSocket('udp4')
      mockServer.bind(testPort, testHost, () => {
        done()
      })
    })

    it('should handle messages sent immediately after initialization', (done) => {
      const testMessage = 'Immediate send'
      const messages: string[] = []

      mockServer?.on('message', (msg) => {
        messages.push(msg.toString())
        if (messages.length === 1) {
          expect(messages[0]).to.equal(testMessage)
          done()
        }
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      // Send immediately without explicit connect()
      // Should auto-connect and send
      client.send(testMessage)
    })

    it('should handle messages during Bun socket initialization (immediate fallback)', (done) => {
      // This test is primarily for Bun runtime
      // In Node.js, the socket is created synchronously, so this tests the fallback
      const messages = ['Message 1', 'Message 2', 'Message 3']
      const received: string[] = []

      mockServer?.on('message', (msg) => {
        received.push(msg.toString())
        if (received.length === messages.length) {
          expect(received).to.have.members(messages)
          done()
        }
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      // Send messages rapidly without waiting for connect()
      // All should be delivered (either immediately via Node or queued for Bun)
      messages.forEach((msg) => {
        client?.send(msg)
      })
    })

    it('should handle rapid successive sends', (done) => {
      const messageCount = 10
      const messages = Array.from(
        { length: messageCount },
        (_, i) => `Message ${i}`,
      )
      const received: string[] = []

      mockServer?.on('message', (msg) => {
        received.push(msg.toString())
        if (received.length === messageCount) {
          expect(received).to.have.members(messages)
          done()
        }
      })

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()

      // Send all messages rapidly
      messages.forEach((msg) => {
        client?.send(msg)
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle send errors gracefully', (done) => {
      let testCompleted = false

      client = new UdpClient({
        host: 'invalid-host-that-does-not-exist-12345.local',
        port: testPort,
        onError: (error) => {
          expect(error).to.be.instanceOf(Error)
        },
      })

      client.send('test message', (_error) => {
        // UDP may or may not report errors immediately
        // Just ensure we don't crash
        if (!testCompleted) {
          testCompleted = true
          done()
        }
      })

      // Give it time to potentially error, but ensure test completes
      setTimeout(() => {
        if (!testCompleted) {
          testCompleted = true
          done()
        }
      }, 100)
    })

    it('should handle socket errors', (done) => {
      let testCompleted = false

      const completeTest = () => {
        if (!testCompleted) {
          testCompleted = true
          done()
        }
      }

      client = new UdpClient({
        host: testHost,
        port: testPort,
        onError: (error, context) => {
          expect(error).to.be.instanceOf(Error)
          expect(context).to.have.property('reason')
        },
      })

      client.connect()

      // Force an error by trying to send after closing
      client.close()
      client.send('test', () => {
        // Message sent after close - should handle gracefully
        completeTest()
      })

      // Ensure test completes even if callback doesn't fire
      setTimeout(completeTest, 50)
    })

    it('should provide context in error callbacks', (done) => {
      const message = 'x'.repeat(9000) // Oversized

      client = new UdpClient({
        host: testHost,
        port: testPort,
        onError: (_error, context) => {
          expect(context).to.be.an('object')
          expect(context).to.have.property('messageSize')
          expect(context).to.have.property('maxSize')
          done()
        },
      })

      client.send(message)
    })
  })

  describe('Runtime Compatibility', () => {
    it('should work in Node.js runtime', () => {
      // This test suite runs in Node.js by default
      expect(typeof process.versions.node).to.equal('string')

      client = new UdpClient({
        host: testHost,
        port: testPort,
      })

      client.connect()
      expect(client.isReady()).to.be.true
    })

    it('should detect Bun runtime if available', () => {
      // Check if we're running in Bun
      const isBun = typeof process.versions.bun !== 'undefined'

      if (isBun) {
        expect(typeof process.versions.bun).to.equal('string')
        console.log('      ✓ Running in Bun runtime')
      } else {
        expect(process.versions.bun).to.be.undefined
        console.log('      ✓ Running in Node.js runtime')
      }
    })
  })
})
