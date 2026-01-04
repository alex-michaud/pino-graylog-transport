'use strict';

const { expect } = require('chai');
const { formatGelf, pinoLevelToSyslog } = require('../../lib/gelf-formatter');

describe('GELF Formatter', () => {
  describe('pinoLevelToSyslog', () => {
    it('should convert fatal level (60) to syslog critical (2)', () => {
      expect(pinoLevelToSyslog(60)).to.equal(2);
    });

    it('should convert error level (50) to syslog error (3)', () => {
      expect(pinoLevelToSyslog(50)).to.equal(3);
    });

    it('should convert warn level (40) to syslog warning (4)', () => {
      expect(pinoLevelToSyslog(40)).to.equal(4);
    });

    it('should convert info level (30) to syslog informational (6)', () => {
      expect(pinoLevelToSyslog(30)).to.equal(6);
    });

    it('should convert debug level (20) to syslog debug (7)', () => {
      expect(pinoLevelToSyslog(20)).to.equal(7);
    });

    it('should convert trace level (10) to syslog debug (7)', () => {
      expect(pinoLevelToSyslog(10)).to.equal(7);
    });
  });

  describe('formatGelf', () => {
    it('should format a basic Pino log to GELF', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message',
        pid: 1234,
        hostname: 'test-host'
      };

      const gelf = formatGelf(pinoLog);

      expect(gelf).to.have.property('version', '1.1');
      expect(gelf).to.have.property('short_message', 'Test message');
      expect(gelf).to.have.property('level', 6);
      expect(gelf).to.have.property('timestamp', 1704408000);
      expect(gelf).to.have.property('facility', 'nodejs');
      expect(gelf).to.have.property('_pid', 1234);
      expect(gelf).to.have.property('_hostname', 'test-host');
    });

    it('should use default message when msg is missing', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000
      };

      const gelf = formatGelf(pinoLog);

      expect(gelf).to.have.property('short_message', 'No message');
    });

    it('should add stack trace as full_message', () => {
      const pinoLog = {
        level: 50,
        time: 1704408000000,
        msg: 'Error occurred',
        stack: 'Error: Something went wrong\n    at test.js:10:15'
      };

      const gelf = formatGelf(pinoLog);

      expect(gelf).to.have.property('full_message', 'Error: Something went wrong\n    at test.js:10:15');
    });

    it('should add custom fields with underscore prefix', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message',
        userId: '12345',
        requestId: 'abc-def-ghi'
      };

      const gelf = formatGelf(pinoLog);

      expect(gelf).to.have.property('_userId', '12345');
      expect(gelf).to.have.property('_requestId', 'abc-def-ghi');
    });

    it('should stringify object custom fields', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message',
        user: { id: 123, name: 'John' }
      };

      const gelf = formatGelf(pinoLog);

      expect(gelf).to.have.property('_user');
      const parsed = JSON.parse(gelf._user);
      expect(parsed).to.deep.equal({ id: 123, name: 'John' });
    });

    it('should accept custom facility option', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message'
      };

      const gelf = formatGelf(pinoLog, { facility: 'my-app' });

      expect(gelf).to.have.property('facility', 'my-app');
    });

    it('should accept custom host option', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message'
      };

      const gelf = formatGelf(pinoLog, { host: 'custom-host' });

      expect(gelf).to.have.property('host', 'custom-host');
    });

    it('should use current time if time is missing', () => {
      const pinoLog = {
        level: 30,
        msg: 'Test message'
      };

      const before = Date.now() / 1000;
      const gelf = formatGelf(pinoLog);
      const after = Date.now() / 1000;

      expect(gelf.timestamp).to.be.at.least(before);
      expect(gelf.timestamp).to.be.at.most(after);
    });
  });
});
