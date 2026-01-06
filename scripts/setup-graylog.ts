import http from 'node:http'

const GRAYLOG_API_HOST = 'localhost'
const GRAYLOG_API_PORT = 9005
const AUTH = `Basic ${Buffer.from('admin:admin').toString('base64')}`

interface GraylogInput {
  title: string
  type: string
  configuration: Record<string, unknown>
  global: boolean
}

interface GraylogInputsResponse {
  inputs: Array<{ title: string; [key: string]: unknown }>
}

const inputs: GraylogInput[] = [
  {
    title: 'GELF TCP',
    type: 'org.graylog2.inputs.gelf.tcp.GELFTCPInput',
    configuration: {
      bind_address: '0.0.0.0',
      port: 12201,
      recv_buffer_size: 1048576,
      use_null_delimiter: true,
      max_message_size: 2097152,
      tls_enable: false,
    },
    global: true,
  },
  {
    title: 'GELF UDP',
    type: 'org.graylog2.inputs.gelf.udp.GELFUDPInput',
    configuration: {
      bind_address: '0.0.0.0',
      port: 12201,
      recv_buffer_size: 262144,
      decompress_size_limit: 8388608,
    },
    global: true,
  },
]

function handleResponse(
  data: string,
  statusCode: number | undefined,
  resolve: (value: unknown) => void,
  reject: (reason: Error) => void,
): void {
  if (statusCode && statusCode >= 200 && statusCode < 300) {
    try {
      resolve(data ? JSON.parse(data) : null)
    } catch (_e: unknown) {
      resolve(data)
    }
  } else {
    reject(new Error(`Request failed with status ${statusCode}: ${data}`))
  }
}

function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: GRAYLOG_API_HOST,
      port: GRAYLOG_API_PORT,
      path: `/api${path}`,
      method: method,
      headers: {
        Authorization: AUTH,
        'Content-Type': 'application/json',
        'X-Requested-By': 'pino-graylog-transport-setup',
      },
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        handleResponse(data, res.statusCode, resolve, reject)
      })
    })

    req.on('error', reject)

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

async function waitForGraylog() {
  console.log('Waiting for Graylog to be ready...')
  let retries = 30
  while (retries > 0) {
    try {
      await request('GET', '/system/lbstatus')
      console.log('Graylog is ready!')
      return
    } catch (_err) {
      process.stdout.write('.')
      await new Promise((resolve) => setTimeout(resolve, 2000))
      retries--
    }
  }
  throw new Error('Graylog failed to start in time')
}

async function setupInputs() {
  try {
    await waitForGraylog()

    const existingInputs = (await request(
      'GET',
      '/system/inputs',
    )) as GraylogInputsResponse
    const existingTitles = existingInputs.inputs.map((i) => i.title)

    for (const input of inputs) {
      if (existingTitles.includes(input.title)) {
        console.log(`Input "${input.title}" already exists.`)
      } else {
        console.log(`Creating input "${input.title}"...`)
        await request('POST', '/system/inputs', input)
        console.log(`Input "${input.title}" created successfully.`)
      }
    }

    console.log('\nSetup complete! Graylog is ready to receive messages.')
  } catch (error) {
    console.error('\nSetup failed:', error)
    process.exit(1)
  }
}

setupInputs()
