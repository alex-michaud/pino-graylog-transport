'use strict';

const { expect } = require('chai');
const GraylogClient = require('../../lib/graylog-client');

describe('GraylogClient', () => {
  describe('constructor', () => {
    it('should create UDP client with default options', () => {
      const client = new GraylogClient();
      
      expect(client.host).to.equal('localhost');
      expect(client.port).to.equal(12201);
      expect(client.protocol).to.equal('udp');
      expect(client.compress).to.equal(true);
      expect(client.socket).to.exist;
    });

    it('should create TCP client when specified', () => {
      const client = new GraylogClient({ protocol: 'tcp' });
      
      expect(client.protocol).to.equal('tcp');
      expect(client.connected).to.equal(false);
      expect(client.messageQueue).to.be.an('array');
    });

    it('should accept custom host and port', () => {
      const client = new GraylogClient({
        host: 'graylog.example.com',
        port: 12202
      });
      
      expect(client.host).to.equal('graylog.example.com');
      expect(client.port).to.equal(12202);
    });

    it('should accept custom maxChunkSize', () => {
      const client = new GraylogClient({ maxChunkSize: 8192 });
      
      expect(client.maxChunkSize).to.equal(8192);
    });

    it('should allow disabling compression', () => {
      const client = new GraylogClient({ compress: false });
      
      expect(client.compress).to.equal(false);
    });
  });

  describe('send', () => {
    it('should send message without throwing errors (UDP)', (done) => {
      const client = new GraylogClient();
      const message = {
        version: '1.1',
        host: 'test',
        short_message: 'Test message',
        level: 6
      };

      // Just verify it doesn't throw
      client.send(message, () => {
        // May get ECONNREFUSED if Graylog not running, but that's ok for unit test
        client.close();
        done();
      });
    });

    it('should send message without throwing errors (TCP)', (done) => {
      const client = new GraylogClient({ protocol: 'tcp' });
      const message = {
        version: '1.1',
        host: 'test',
        short_message: 'Test message',
        level: 6
      };

      // Just verify it doesn't throw
      client.send(message, () => {
        client.close();
        done();
      });
    });
  });

  describe('close', () => {
    it('should close UDP socket', () => {
      const client = new GraylogClient();
      
      expect(() => client.close()).to.not.throw();
    });

    it('should close TCP socket', () => {
      const client = new GraylogClient({ protocol: 'tcp' });
      
      expect(() => client.close()).to.not.throw();
    });
  });
});
