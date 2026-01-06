# pino-graylog-transport

A Pino transport module that sends log messages to Graylog using the GELF (Graylog Extended Log Format) protocol over TCP or TLS.

## Features

- 🚀 Full support for Pino transports API
- 📦 GELF (Graylog Extended Log Format) message formatting
- 🔒 TLS and TCP protocol support (secure by default)
- 🔧 Configurable facility, host, and port
- 📊 Automatic log level conversion (Pino → Syslog)
- 🏷️ Custom field support with GELF underscore prefix
- ⚡ High-performance async message sending with buffering and reconnection logic

## Installation

```bash
npm install pino-graylog-transport pino
```

## Quick Start

```javascript
const pino = require('pino');
const transport = require('pino-graylog-transport');

const transportInstance = transport({
  host: 'graylog.example.com',
  port: 12201,
  // Use 'tls' for encrypted connections to remote Graylog servers
  protocol: 'tls',
  facility: 'my-app',
  staticMeta: {
    environment: 'production',
    service: 'api',
    version: '1.0.0'
  }
});

const logger = pino(transportInstance);

logger.info('Hello Graylog!');
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `'localhost'` | Graylog server hostname |
| `port` | number | `12201` | Graylog GELF input port (standard GELF TCP port) |
| `protocol` | string | `'tcp'` | Protocol to use (`'tcp'` or `'tls'`) |
| `facility` | string | `hostname` | **Application/service identifier** sent with every message. Used to categorize logs by application in Graylog (e.g., `'api-gateway'`, `'auth-service'`). Sent as `_facility` additional field per [GELF spec](https://go2docs.graylog.org/current/getting_in_log_data/gelf.html). |
| `hostname` | string | `os.hostname()` | Host field in GELF messages (the machine/server name) |
| `staticMeta` | object | `{}` | Static fields included in **every** log message (e.g., auth tokens, environment, datacenter). These are sent as GELF custom fields with underscore prefix. |
| `maxQueueSize` | number | `1000` | Max messages to queue when disconnected |
| `onError` | function | `console.error` | Custom error handler |
| `onReady` | function | `undefined` | Callback when connection is established |

## Using with Authentication Tokens

Some Graylog services require authentication tokens to be sent with every log message. Use `staticMeta` to include these tokens and any other metadata that should be sent with **all** log messages:

```javascript
const transport = require('pino-graylog-transport');

// Example: OVH Logs Data Platform
const stream = transport({
  host: 'bhs1.logs.ovh.com',
  port: 12202,
  protocol: 'tls',
  staticMeta: {
    'X-OVH-TOKEN': 'your-ovh-token-here'
  }
});

// Example: Generic cloud provider with token
const stream = transport({
  host: 'graylog.example.com',
  port: 12201,
  protocol: 'tls',
  staticMeta: {
    token: 'your-auth-token',
    environment: 'production',
    datacenter: 'us-east-1'
  }
});
```

All fields in `staticMeta` will be included in every GELF message with an underscore prefix (e.g., `_X-OVH-TOKEN`, `_token`, `_environment`).

## Understanding Configuration Fields

### `facility` vs `hostname` vs `staticMeta`

These three configuration options serve different purposes:

| Field | Purpose | Example | GELF Field | When to Use |
|-------|---------|---------|------------|-------------|
| `facility` | **Application/service identifier** | `'api-gateway'`, `'auth-service'` | `_facility` | Identify which application/microservice sent the log |
| `hostname` | **Machine/server identifier** | `'web-server-01'`, `'us-east-1a'` | `host` | Identify which machine/container/pod sent the log |
| `staticMeta` | **Context metadata** | `{ token: 'abc', env: 'prod' }` | `_token`, `_env` | Add authentication tokens or contextual info |

### Example: Microservices Architecture

```javascript
// API Gateway service running on server 1
transport({
  facility: 'api-gateway',        // What service?
  hostname: 'web-server-01',      // Which machine?
  staticMeta: {
    environment: 'production',    // Extra context
    region: 'us-east-1',
    version: '2.1.0'
  }
});

// Auth Service running on server 2
transport({
  facility: 'auth-service',       // What service?
  hostname: 'web-server-02',      // Which machine?
  staticMeta: {
    environment: 'production',
    region: 'us-east-1',
    version: '1.5.3'
  }
});
```

In Graylog, you can then:
- Filter by `_facility:api-gateway` to see all API gateway logs
- Filter by `host:web-server-01` to see all logs from that server
- Filter by `_environment:production` to see production logs across all services

## Local Development with Docker

This repository includes a Docker Compose configuration to run Graylog locally for testing.

### Start Graylog

```bash
npm run docker:up
# or
docker compose up -d
```

Wait about 30 seconds for Graylog to fully start, then run the setup script to create the GELF inputs:

```bash
npm run docker:setup
```

Then access the web interface at:
- URL: http://localhost:9005
- Username: `admin`
- Password: `admin`

### Stop Graylog

```bash
npm run docker:down
# or
docker compose down
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

# View logs at http://localhost:9005
```

## Testing

### Install Dependencies

```bash
npm install
```

### Unit Tests

Run the library functionality tests (no external dependencies required):

```bash
npm test
# or
npm run test:unit
```

### Integration Tests

Integration tests require a running Graylog instance:

```bash
# Start Graylog first
npm run docker:up
npm run docker:setup

# Run integration tests
npm run test:integration
```

### Run All Tests

Run both unit and integration tests:

```bash
npm run test:all
```

### Load Tests with k6

Load tests use [k6](https://k6.io) to simulate high-volume logging scenarios.

#### Install k6

```bash
# macOS
brew install k6
```
```bash
# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

```bash
# Windows
choco install k6
```

#### Run Load Tests

```bash
# Start Graylog
npm run docker:up

# Setup Graylog inputs (wait for Graylog to be ready first)
npm run docker:setup

# Start the load test server
npm run start:load-server

# In another terminal, run the k6 load test
npm run test:load

# Or run a quick smoke test (20 seconds)
npm run test:smoke
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
│   ├── index.ts           # Main transport entry point
│   ├── gelf-formatter.ts  # GELF message formatter
│   └── graylog-transport.ts # TCP/TLS transport
├── test/                  # Tests
│   ├── unit/             # Unit tests
│   │   ├── gelf-formatter.test.ts
│   │   ├── graylog-transport.test.ts
│   │   └── integration.test.ts
│   ├── load/             # Load tests
│   │   ├── load-test.ts  # k6 load test script
│   │   ├── smoke-test.ts # k6 smoke test script
│   │   └── server.ts     # Test server for load testing
│   └── benchmark/        # Performance benchmarks
│       ├── benchmark.ts            # Microbenchmark (formatting)
│       ├── comparison-server.ts    # Server for pino vs winston test
│       └── comparison-load-test.ts # k6 comparison load test
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

## Performance

The GELF formatting logic is optimized for speed. Benchmarks were run using [mitata](https://github.com/evanwashere/mitata) to measure the overhead of message transformation (excluding network I/O).

### Benchmark Results

| Benchmark | Time | Description |
|-----------|------|-------------|
| JSON.stringify (Raw) | 614 ns | Baseline - just serialization, no transformation |
| **pino-graylog-transport** | **1.87 µs** | Our GELF formatter |
| Manual GELF Construction | 2.21 µs | Simulated naive implementation |

### Key Takeaways

- ✅ **18% faster** than a naive manual GELF construction approach
- ✅ **~535,000 messages/second** theoretical formatting throughput (single-threaded)
- ✅ **Negligible overhead**: The ~1.25 µs formatting overhead is 500-50,000x smaller than typical network latency

### Run Benchmarks

```bash
# Run formatting microbenchmark (no network)
npm run benchmark
```

### Comparison Load Test (pino vs winston)

This test compares the real-world performance of `pino-graylog-transport` against `winston + winston-log2gelf`:

```bash
# Start Graylog
npm run docker:up
npm run docker:setup

# Start the comparison server (in one terminal)
npm run start:comparison-server

# Run the comparison load test (in another terminal)
npm run benchmark:load
```

The test runs three scenarios in parallel:
- **Baseline**: No logging (measures pure HTTP overhead)
- **Pino**: Using pino-graylog-transport
- **Winston**: Using winston + winston-log2gelf

Compare the `*_duration` metrics to see the logging overhead for each library.

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Requirements

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)

This package requires Node.js >= 22 (declared in package.json `engines`). The CI and release workflows prefer the latest Node LTS. If your local Node version is older, upgrade Node (for example, using nvm):

```bash
# Install nvm (if not present)
# https://github.com/nvm-sh/nvm#installing-and-updating

# Use latest LTS
nvm install --lts
nvm use --lts
```
