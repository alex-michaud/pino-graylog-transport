'use strict';

const dgram = require('dgram');
const net = require('net');
const zlib = require('zlib');

/**
 * Graylog client for sending GELF messages via UDP or TCP
 */
class GraylogClient {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 12201;
    this.protocol = options.protocol || 'udp'; // 'udp' or 'tcp'
    this.maxChunkSize = options.maxChunkSize || 1420; // Max size for UDP chunks
    this.compress = options.compress !== false; // Compress by default for UDP

    if (this.protocol === 'udp') {
      this.socket = dgram.createSocket('udp4');
      this.socket.on('error', (err) => {
        console.error('UDP socket error:', err);
      });
    } else if (this.protocol === 'tcp') {
      this.tcpSocket = null;
      this.connecting = false;
      this.connected = false;
      this.messageQueue = [];
    }
  }

  /**
   * Connect to Graylog server (TCP only)
   */
  _connectTcp() {
    if (this.connected || this.connecting) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.connecting = true;
      this.tcpSocket = net.createConnection(this.port, this.host);

      this.tcpSocket.on('connect', () => {
        this.connected = true;
        this.connecting = false;
        this._flushQueue();
        resolve();
      });

      this.tcpSocket.on('error', (err) => {
        this.connected = false;
        this.connecting = false;
        console.error('TCP connection error:', err);
        reject(err);
      });

      this.tcpSocket.on('close', () => {
        this.connected = false;
        this.connecting = false;
        this.tcpSocket = null;
      });
    });
  }

  /**
   * Flush queued messages (TCP only)
   */
  _flushQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const message = this.messageQueue.shift();
      this._sendTcp(message);
    }
  }

  /**
   * Send message via TCP
   */
  _sendTcp(message) {
    const buffer = Buffer.from(JSON.stringify(message) + '\0');
    
    if (!this.connected) {
      this.messageQueue.push(message);
      this._connectTcp().catch(() => {
        // Connection error already logged
      });
      return;
    }

    this.tcpSocket.write(buffer, (err) => {
      if (err) {
        console.error('TCP write error:', err);
      }
    });
  }

  /**
   * Send message via UDP
   */
  _sendUdp(message, callback) {
    const json = JSON.stringify(message);
    const payload = Buffer.from(json);

    // Compress if enabled
    if (this.compress) {
      zlib.gzip(payload, (err, compressed) => {
        if (err) {
          console.error('Compression error:', err);
          if (callback) callback(err);
          return;
        }
        this._sendUdpBuffer(compressed, callback);
      });
    } else {
      this._sendUdpBuffer(payload, callback);
    }
  }

  /**
   * Send UDP buffer (with chunking if needed)
   */
  _sendUdpBuffer(buffer, callback) {
    // If message fits in one packet, send it
    if (buffer.length <= this.maxChunkSize) {
      this.socket.send(buffer, 0, buffer.length, this.port, this.host, (err) => {
        if (err) {
          console.error('UDP send error:', err);
        }
        if (callback) callback(err);
      });
      return;
    }

    // Message is too large, would need chunking (not implemented for simplicity)
    // In production, implement GELF chunking protocol
    console.warn('Message too large for single UDP packet, truncating');
    const truncated = buffer.slice(0, this.maxChunkSize);
    this.socket.send(truncated, 0, truncated.length, this.port, this.host, (err) => {
      if (err) {
        console.error('UDP send error:', err);
      }
      if (callback) callback(err);
    });
  }

  /**
   * Send a GELF message to Graylog
   */
  send(message, callback) {
    if (this.protocol === 'tcp') {
      this._sendTcp(message);
      if (callback) callback();
    } else {
      this._sendUdp(message, callback);
    }
  }

  /**
   * Close the connection
   */
  close() {
    if (this.protocol === 'udp' && this.socket) {
      this.socket.close();
    } else if (this.protocol === 'tcp' && this.tcpSocket) {
      this.tcpSocket.end();
    }
  }
}

module.exports = GraylogClient;
