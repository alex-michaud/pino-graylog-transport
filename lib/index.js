'use strict';

const build = require('pino-abstract-transport');
const { formatGelf } = require('./gelf-formatter');
const GraylogClient = require('./graylog-client');

/**
 * Create a Pino transport for Graylog
 * @param {Object} options - Transport options
 * @param {string} options.host - Graylog host (default: 'localhost')
 * @param {number} options.port - Graylog port (default: 12201)
 * @param {string} options.protocol - 'udp' or 'tcp' (default: 'udp')
 * @param {string} options.facility - Facility name (default: 'nodejs')
 * @param {boolean} options.compress - Compress messages for UDP (default: true)
 * @returns {Promise} Pino transport
 */
async function createTransport(options) {
  const client = new GraylogClient({
    host: options.host,
    port: options.port,
    protocol: options.protocol,
    maxChunkSize: options.maxChunkSize,
    compress: options.compress
  });

  return build(async function (source) {
    for await (const obj of source) {
      try {
        const gelfMessage = formatGelf(obj, {
          facility: options.facility,
          host: options.graylogHost
        });
        
        client.send(gelfMessage);
      } catch (err) {
        console.error('Error sending log to Graylog:', err);
      }
    }
  }, {
    close(err, cb) {
      client.close();
      cb(err);
    }
  });
}

module.exports = createTransport;
