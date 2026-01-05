# pino-graylog-transport

A Pino transport module that sends log messages to Graylog using the GELF (Graylog Extended Log Format) protocol.

## Features

- 🚀 Full support for Pino transports API
- 📦 GELF (Graylog Extended Log Format) message formatting
- 🌐 UDP and TCP protocol support
- 🗜️ Optional compression for UDP messages
- 🔧 Configurable facility, host, and port
- 📊 Automatic log level conversion (Pino → Syslog)
- 🏷️ Custom field support with GELF underscore prefix
- ⚡ High-performance async message sending

## Installation

```bash
npm install pino-graylog-transport pino
```

## Quick Start

```javascript
const pino = require('pino');
const transport = require('pino-graylog-transport');

async function main() {
  // Create the transport
  const transportInstance = await transport({
    host: 'localhost',
    port: 12201,
    protocol: 'udp',
    facility: 'my-app'
  });

  // Create pino logger with the transport
  const logger = pino(transportInstance);

  // Start logging!
  logger.info('Hello Graylog!');
  logger.error({ userId: 123 }, 'An error occurred');
}

main();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `'localhost'` | Graylog server hostname |
| `port` | number | `12201` | Graylog GELF input port |
| `protocol` | string | `'udp'` | Protocol to use (`'udp'` or `'tcp'`) |
| `facility` | string | `'nodejs'` | Facility name for GELF messages |
| `graylogHost` | string | `os.hostname()` | Host field in GELF messages |
| `compress` | boolean | `true` | Compress UDP messages with gzip |
| `maxChunkSize` | number | `1420` | Maximum UDP packet size |

## Local Development with Docker

This repository includes a Docker Compose configuration to run Graylog locally for testing.

### Start Graylog

```bash
npm run docker:up
# or
docker-compose up -d
```

Wait about 30 seconds for Graylog to fully start, then access the web interface at:
- URL: http://localhost:9000
- Username: `admin`
- Password: `admin`

### Stop Graylog

```bash
npm run docker:down
# or
docker-compose down
```

## Usage Examples

### Basic Logging

```javascript
const pino = require('pino');
const transport = require('pino-graylog-transport');

const logger = pino(await transport({
  host: 'localhost',
  port: 12201
}));

logger.info('Application started');
logger.warn('Warning message');
logger.error('Error message');
```

### Logging with Custom Fields

```javascript
logger.info({
  userId: 123,
  action: 'login',
  ip: '192.168.1.1'
}, 'User logged in');

// In Graylog, these will appear as: _userId, _action, _ip
```

### Error Logging with Stack Traces

```javascript
try {
  throw new Error('Something went wrong!');
} catch (err) {
  logger.error({ err }, 'An error occurred');
  // Stack trace will be sent as full_message in GELF
}
```

### TCP Protocol

```javascript
const logger = pino(await transport({
  host: 'localhost',
  port: 12201,
  protocol: 'tcp'  // Use TCP instead of UDP
}));
```

### Run the Example

```bash
# Start Graylog first
npm run docker:up

# Run the example (after installing dependencies)
npm install
node examples/basic.js

# View logs at http://localhost:9000
```

## Testing

### Install Dependencies

```bash
npm install
```

### Unit Tests

Run the library functionality tests:

```bash
npm test
```

Skip integration tests (if Graylog is not running):

```bash
SKIP_INTEGRATION=true npm test
```

### Load Tests with k6

Load tests use [k6](https://k6.io) to simulate high-volume logging scenarios.

#### Install k6

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

#### Run Load Tests

```bash
# Start Graylog
npm run docker:up

# Start the load test server
node test/load/server.js

# In another terminal, run the k6 load test
npm run test:load
```

The load test will:
- Ramp up from 0 to 50 virtual users
- Send thousands of log messages
- Measure throughput and latency
- Verify 95% success rate

## Project Structure

```
pino-graylog-transport/
├── lib/                    # Source code
│   ├── index.js           # Main transport entry point
│   ├── gelf-formatter.js  # GELF message formatter
│   └── graylog-client.js  # UDP/TCP client
├── test/                  # Tests
│   ├── unit/             # Unit tests
│   │   ├── gelf-formatter.test.js
│   │   ├── graylog-client.test.js
│   │   └── integration.test.js
│   └── load/             # Load tests
│       ├── load-test.js  # k6 load test script
│       └── server.js     # Test server for load testing
├── examples/             # Usage examples
│   └── basic.js
├── docker-compose.yml    # Graylog local setup
└── package.json
```

## Log Level Mapping

Pino log levels are automatically converted to Syslog severity levels for Graylog:

| Pino Level | Numeric | Syslog Level | Numeric |
|------------|---------|--------------|---------|
| fatal      | 60      | Critical     | 2       |
| error      | 50      | Error        | 3       |
| warn       | 40      | Warning      | 4       |
| info       | 30      | Informational| 6       |
| debug      | 20      | Debug        | 7       |
| trace      | 10      | Debug        | 7       |

## GELF Message Format

The transport converts Pino log objects to GELF format:

- `short_message`: The log message
- `full_message`: Stack trace (if present)
- `level`: Syslog severity level
- `timestamp`: Unix timestamp
- `host`: Hostname
- `facility`: Application/service name
- `_*`: Custom fields (all Pino log object properties)

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

