#!/usr/bin/env node
'use strict';

/**
 * Example usage of pino-graylog-transport
 * 
 * Before running this example:
 * 1. Start Graylog: docker-compose up -d
 * 2. Wait for Graylog to be ready (~30 seconds)
 * 3. Run this script: node examples/basic.js
 * 4. View logs at http://localhost:9005 (username: admin, password: admin)
 */

const pino = require('pino');
const transport = require('../lib/index');

async function main() {
  console.log('Creating Pino logger with Graylog transport...');
  
  // Create the transport
  const transportInstance = await transport({
    host: 'localhost',
    port: 12201,
    protocol: 'udp',  // or 'tcp'
    facility: 'example-app',
    compress: true    // compress messages (UDP only)
  });

  // Create pino logger with the transport
  const logger = pino(
    {
      level: 'debug'
    },
    transportInstance
  );

  console.log('Sending logs to Graylog...\n');

  // Send various log levels
  logger.info('Application started');
  logger.debug({ userId: 123 }, 'User logged in');
  logger.warn({ diskSpace: '90%' }, 'Disk space running low');
  
  // Log with custom fields
  logger.info({
    userId: 123,
    action: 'purchase',
    amount: 99.99,
    currency: 'USD'
  }, 'Purchase completed');

  // Error logging with stack trace
  try {
    throw new Error('Something went wrong!');
  } catch (err) {
    logger.error({ err }, 'An error occurred');
  }

  // Multiple logs in sequence
  for (let i = 0; i < 5; i++) {
    logger.info({ iteration: i }, `Loop iteration ${i}`);
  }

  console.log('\nLogs sent! Check Graylog at http://localhost:9005');
  console.log('Username: admin, Password: admin');
  console.log('\nWaiting 2 seconds before closing...');

  // Wait a bit for messages to be sent
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Close the transport
  await new Promise((resolve) => {
    transportInstance.end(() => {
      console.log('Transport closed. Exiting.');
      resolve();
    });
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
