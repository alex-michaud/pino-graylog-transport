import { check, sleep } from 'k6'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'
import type { Options } from 'k6/options'

/**
 * K6 Comparison Load Test
 *
 * Compares performance of:
 * - Baseline (no logging)
 * - pino-graylog-transport
 * - winston + winston-graylog2
 */

// Custom metrics for each endpoint
const baselineDuration = new Trend('baseline_duration')
const pinoDuration = new Trend('pino_duration')
const winstonDuration = new Trend('winston_duration')

const baselineSuccess = new Rate('baseline_success')
const pinoSuccess = new Rate('pino_success')
const winstonSuccess = new Rate('winston_success')

const baselineRequests = new Counter('baseline_requests')
const pinoRequests = new Counter('pino_requests')
const winstonRequests = new Counter('winston_requests')

// Test configuration
const VUS = 100 // 100 VUs per scenario
const DURATION = '15s'

export const options: Options = {
  scenarios: {
    // Run scenarios SEQUENTIALLY to avoid interference
    // Baseline runs first (0s-15s)
    baseline: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      startTime: '0s',
      exec: 'testBaseline',
    },
    // Pino runs second (20s-35s) - 5s gap for cooldown
    pino: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      startTime: '20s',
      exec: 'testPino',
    },
    // Winston runs third (40s-55s) - 5s gap for cooldown
    winston: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      startTime: '40s',
      exec: 'testWinston',
    },
  },
  thresholds: {
    // Relax thresholds for high load
    baseline_duration: ['p(95)<200'],
    pino_duration: ['p(95)<300'],
    winston_duration: ['p(95)<500'],
    // All should have high success rate
    baseline_success: ['rate>0.99'],
    pino_success: ['rate>0.99'],
    winston_success: ['rate>0.99'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'

// Generate a larger payload to stress serialization
const largeMetadata: Record<string, string> = {}
for (let i = 0; i < 100; i++) {
  largeMetadata[`field_${i}`] =
    `value_${i}_${Math.random().toString(36).substring(7)}`
}

const payload = JSON.stringify({
  message: 'Benchmark log message with large payload',
  metadata: {
    userId: 12345,
    action: 'benchmark_aggressive',
    timestamp: new Date().toISOString(),
    ...largeMetadata,
  },
})

const params = {
  headers: {
    'Content-Type': 'application/json',
  },
}

export function setup() {
  console.log('Starting comparison load test...')
  console.log(`Target URL: ${BASE_URL}`)
  console.log('')
  console.log('Testing three scenarios:')
  console.log('  1. Baseline (no logging)')
  console.log('  2. pino-graylog-transport')
  console.log('  3. winston + winston-graylog2')
  console.log('')

  // Health check
  const healthCheck = http.get(`${BASE_URL}/health`)
  if (healthCheck.status !== 200) {
    console.error(
      'Server health check failed! Is the comparison server running?',
    )
    console.error('Run: npm run start:comparison-server')
  }
}

// Baseline test - no logging
export function testBaseline() {
  const start = Date.now()
  const response = http.post(`${BASE_URL}/baseline`, payload, params)
  const duration = Date.now() - start

  const success = check(response, {
    'baseline status 200': (r) => r.status === 200,
  })

  baselineDuration.add(duration)
  baselineSuccess.add(success ? 1 : 0)
  baselineRequests.add(1)

  sleep(0.01) // 10ms between requests
}

// Pino test - our transport
export function testPino() {
  const start = Date.now()
  const response = http.post(`${BASE_URL}/pino`, payload, params)
  const duration = Date.now() - start

  const success = check(response, {
    'pino status 200': (r) => r.status === 200,
  })

  pinoDuration.add(duration)
  pinoSuccess.add(success ? 1 : 0)
  pinoRequests.add(1)

  sleep(0.01) // 10ms between requests
}

// Winston test - winston-graylog2
export function testWinston() {
  const start = Date.now()
  const response = http.post(`${BASE_URL}/winston`, payload, params)
  const duration = Date.now() - start

  const success = check(response, {
    'winston status 200': (r) => r.status === 200,
  })

  winstonDuration.add(duration)
  winstonSuccess.add(success ? 1 : 0)
  winstonRequests.add(1)

  sleep(0.01) // 10ms between requests
}

export function teardown() {
  console.log('')
  console.log('='.repeat(60))
  console.log('COMPARISON LOAD TEST COMPLETED (Sequential)')
  console.log('='.repeat(60))
  console.log('')
  console.log('Tests ran sequentially to avoid interference:')
  console.log('  1. Baseline (0s-15s): No logging')
  console.log('  2. Pino (20s-35s): pino-graylog-transport')
  console.log('  3. Winston (40s-55s): winston + winston-log2gelf')
  console.log('')
  console.log('Compare the metrics above:')
  console.log('  - baseline_requests: throughput without logging')
  console.log('  - pino_requests:     throughput with pino transport')
  console.log('  - winston_requests:  throughput with winston transport')
  console.log('')
  console.log('Higher requests/s = better performance')
  console.log(
    'Sequential testing ensures no resource contention between transports.',
  )
  console.log('')
  console.log(
    'Check Graylog UI at http://localhost:9005 to verify logs were received.',
  )
}

// Provide a no-op default export so bundlers/k6 recognize the module has exports.
// k6 will still use the named exports defined above for its scenarios.
export default function __k6_noop() {
  // no-op
}
