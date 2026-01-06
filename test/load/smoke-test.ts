import { check, sleep } from 'k6'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'
import type { Options } from 'k6/options'

// Custom metrics
const logsSent = new Counter('logs_sent')
const logsSuccessful = new Counter('logs_successful')
const logsFailed = new Counter('logs_failed')
const logDuration = new Trend('log_duration')
const successRate = new Rate('success_rate')

// Test configuration
export const options: Options = {
  stages: [
    { duration: '5s', target: 5 }, // Ramp up to 5 VUs
    { duration: '10s', target: 5 }, // Stay at 5 VUs
    { duration: '5s', target: 0 }, // Ramp down to 0
  ],
  thresholds: {
    logs_sent: ['count>50'], // Should send more than 50 logs
    http_req_duration: ['p(95)<200'], // 95% of requests should be <200ms
    success_rate: ['rate>0.95'], // 95% success rate
    http_req_failed: ['rate<0.05'], // Less than 5% failure rate
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// The setup function runs once before the test
export function setup() {
  console.log('Starting smoke test...')
  console.log(`Target URL: ${BASE_URL}`)
  console.log('Make sure the load test server is running:')
  console.log('  npm run start:load-server')

  // Check if server is running
  const healthCheck = http.get(`${BASE_URL}/health`)
  if (healthCheck.status !== 200) {
    console.error('Server health check failed! Is the server running?')
  }
}

// Main test function
export default function () {
  const logLevels = ['info', 'warn', 'error', 'debug']
  const randomLevel = logLevels[Math.floor(Math.random() * logLevels.length)]

  const payload = JSON.stringify({
    level: randomLevel,
    message: `Smoke test message at ${new Date().toISOString()}`,
    metadata: {
      userId: Math.floor(Math.random() * 10000),
      action: 'smoke_test',
      iteration: __ITER,
      vu: __VU,
    },
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  }

  const startTime = Date.now()
  const response = http.post(`${BASE_URL}/log`, payload, params)
  const duration = Date.now() - startTime

  // Check response
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response is JSON': (r) => r.headers['Content-Type'] === 'application/json',
  })

  // Record metrics
  logsSent.add(1)
  logDuration.add(duration)
  successRate.add(success)

  if (success) {
    logsSuccessful.add(1)
  } else {
    logsFailed.add(1)
  }

  // Small sleep to prevent overwhelming the system
  sleep(0.1)
}

// The teardown function runs once after the test
export function teardown() {
  console.log('Smoke test completed!')
  console.log('Check Graylog UI at http://localhost:9005 to see the logs')
}
