import { expect } from 'chai'
import { formatGelfMessage, mapPinoLevelToGelf } from '../../lib/gelf-formatter'

describe('GELF Formatter', () => {
  describe('mapPinoLevelToGelf', () => {
    it('should convert fatal level (60) to syslog critical (2)', () => {
      expect(mapPinoLevelToGelf(60)).to.equal(2)
    })

    it('should convert error level (50) to syslog error (3)', () => {
      expect(mapPinoLevelToGelf(50)).to.equal(3)
    })

    it('should convert warn level (40) to syslog warning (4)', () => {
      expect(mapPinoLevelToGelf(40)).to.equal(4)
    })

    it('should convert info level (30) to syslog informational (6)', () => {
      expect(mapPinoLevelToGelf(30)).to.equal(6)
    })

    it('should convert debug level (20) to syslog debug (7)', () => {
      expect(mapPinoLevelToGelf(20)).to.equal(7)
    })

    it('should convert trace level (10) to syslog debug (7)', () => {
      expect(mapPinoLevelToGelf(10)).to.equal(7)
    })
  })

  describe('formatGelfMessage', () => {
    const hostname = 'test-host'
    const facility = 'nodejs'

    it('should format a basic Pino log to GELF', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message',
        pid: 1234,
        hostname: 'original-host'
      }

      const gelfString = formatGelfMessage(pinoLog, hostname, facility)
      const gelf = JSON.parse(gelfString)

      expect(gelf).to.have.property('version', '1.1')
      expect(gelf).to.have.property('short_message', 'Test message')
      expect(gelf).to.have.property('level', 6)
      expect(gelf).to.have.property('timestamp', 1704408000)
      expect(gelf).to.have.property('_facility', 'nodejs')
      expect(gelf).to.have.property('host', 'test-host')
      expect(gelf).to.have.property('_pid', 1234)
    })

    it('should use default message when msg is missing', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000
      }

      const gelfString = formatGelfMessage(pinoLog, hostname, facility)
      const gelf = JSON.parse(gelfString)

      expect(gelf).to.have.property('short_message', JSON.stringify(pinoLog))
    })

    it('should add stack trace as full_message', () => {
      const pinoLog = {
        level: 50,
        time: 1704408000000,
        msg: 'Error occurred',
        stack: 'Error: Something went wrong\n    at test.js:10:15'
      }

      const gelfString = formatGelfMessage(pinoLog, hostname, facility)
      const gelf = JSON.parse(gelfString)

      expect(gelf).to.have.property('full_message', 'Error: Something went wrong\n    at test.js:10:15')
    })

    it('should add custom fields with underscore prefix', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message',
        userId: '12345',
        requestId: 'abc-def-ghi'
      }

      const gelfString = formatGelfMessage(pinoLog, hostname, facility)
      const gelf = JSON.parse(gelfString)

      expect(gelf).to.have.property('_userId', '12345')
      expect(gelf).to.have.property('_requestId', 'abc-def-ghi')
    })

    it('should stringify object custom fields', () => {
      const pinoLog = {
        level: 30,
        time: 1704408000000,
        msg: 'Test message',
        user: { id: 123, name: 'John' }
      }

      const gelfString = formatGelfMessage(pinoLog, hostname, facility)
      const gelf = JSON.parse(gelfString)

      expect(gelf).to.have.property('_user', '{"id":123,"name":"John"}')
    })

    it('should include static metadata', () => {
      const pinoLog = {
        level: 30,
        msg: 'Test'
      }
      const staticMeta = { '_X-OVH-TOKEN': 'secret' }

      const gelfString = formatGelfMessage(pinoLog, hostname, facility, staticMeta)
      const gelf = JSON.parse(gelfString)

      expect(gelf).to.have.property('_X-OVH-TOKEN', 'secret')
    })
  })
})

