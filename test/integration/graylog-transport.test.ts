import pino from 'pino'
import type { PinoGraylogTransportOptions } from '../../lib/graylog-transport'
import transport from '../../lib/index'

describe('Integration Tests', () => {
  // These tests require Graylog to be running (docker-compose up)
  // They can be skipped if SKIP_INTEGRATION env var is set
  const skipIntegration = process.env.SKIP_INTEGRATION === 'true'

  ;(skipIntegration ? describe.skip : describe)(
    'Pino Graylog Transport',
    () => {
      it('should create transport and send logs via TCP', async function () {
        // allow long enough for connection attempts in CI
        this.timeout(5000)

        const opts: PinoGraylogTransportOptions = {
          host: 'localhost',
          port: 12201, // Ensure your local Graylog is listening on this TCP port
          protocol: 'tcp',
          facility: 'test-app',
          staticMeta: { _env: 'test' },
          // use non-blocking behavior for integration test to avoid hanging
          waitForDrain: false,
          dropWhenFull: true,
          onReady: (_success: boolean) => {},
        }

        // Promise that resolves with boolean: true if connected, false if failed or timed out
        const readyPromise: Promise<boolean> = new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 2000)
          opts.onReady = (success: boolean) => {
            clearTimeout(timeout)
            resolve(Boolean(success))
          }
        })

        const transportInstance = transport(opts)

        const connected = await readyPromise
        if (!connected) {
          // If Graylog is not reachable, skip this test instead of failing
          this.skip()
          return
        }

        const logger = pino({ level: 'info' }, transportInstance)

        // Send various log levels
        logger.info('Info message')
        logger.warn('Warning message')
        logger.error('Error message')
        logger.debug({ userId: 123 }, 'Debug with data')

        // Give some time for messages to be sent
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Close the transport
        await new Promise<void>((resolve) => {
          transportInstance.end(() => resolve())
        })
      })

      // TLS testing locally is hard without certs, so we might skip or mock it,
      // but for now let's stick to TCP for local integration testing unless we have a TLS setup.
    },
  )
})
