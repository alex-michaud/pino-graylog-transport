'use strict';

const pino = require('pino');
const transport = require('../../lib/index');

describe('Integration Tests', () => {
  // These tests require Graylog to be running (docker-compose up)
  // They can be skipped if SKIP_INTEGRATION env var is set
  const skipIntegration = process.env.SKIP_INTEGRATION === 'true';

  (skipIntegration ? describe.skip : describe)('Pino Graylog Transport', () => {
    it('should create transport and send logs', async () => {
      const transportInstance = await transport({
        host: 'localhost',
        port: 12201,
        protocol: 'udp',
        facility: 'test-app'
      });

      const logger = pino(transportInstance);

      // Send various log levels
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      logger.debug({ userId: 123 }, 'Debug with data');

      // Give some time for messages to be sent
      await new Promise(resolve => setTimeout(resolve, 100));

      // Close the transport
      await new Promise((resolve) => {
        transportInstance.end(() => resolve());
      });
    });

    it('should handle TCP transport', async () => {
      const transportInstance = await transport({
        host: 'localhost',
        port: 12201,
        protocol: 'tcp',
        facility: 'test-app'
      });

      const logger = pino(transportInstance);

      logger.info('TCP message');

      await new Promise(resolve => setTimeout(resolve, 100));

      await new Promise((resolve) => {
        transportInstance.end(() => resolve());
      });
    });
  });
});
