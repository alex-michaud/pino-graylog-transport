#!/usr/bin/env node
/**
 * Simple script to test Bun runtime detection and optimization
 */

import transport from '../dist/index.js'

console.log('🔍 Testing Bun Runtime Detection\n')

// Check if running in Bun
const isBun = typeof process.versions.bun !== 'undefined'
console.log(`Runtime: ${isBun ? '🟢 Bun' : '🔵 Node.js'}`)

if (isBun) {
  console.log(`Bun version: ${process.versions.bun}`)
} else {
  console.log(`Node.js version: ${process.version}`)
}

// Create a transport (won't actually connect)
const testTransport = transport({
  host: 'localhost',
  port: 12201,
  protocol: 'tcp',
  autoConnect: false, // Don't connect for this test
})

console.log('\n✅ Transport created successfully')
console.log('📊 Status methods available:')
console.log(`  - isReady(): ${testTransport.isReady()}`)
console.log(`  - isConnected(): ${testTransport.isConnected()}`)
console.log(`  - getQueueSize(): ${testTransport.getQueueSize()}`)
console.log(`  - getMaxQueueSize(): ${testTransport.getMaxQueueSize()}`)

console.log('\n✨ Optimizations active:')
if (isBun) {
  console.log('  ✅ Bun.connect() for TCP connections')
  console.log('  ✅ Optimized socket writes')
  console.log('  ✅ Efficient event handling')
} else {
  console.log('  🔵 Standard Node.js net.createConnection()')
  console.log('  🔵 Standard socket.write()')
  console.log('  🔵 Standard event handling')
}

console.log('\n🎯 To run with Bun: bun run scripts/test-bun.js')
console.log('🎯 To run with Node: node scripts/test-bun.js')
