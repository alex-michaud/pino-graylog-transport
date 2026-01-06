#!/usr/bin/env node
const fs = require('node:fs')

function parseRequiredMajor(engineSpec) {
  if (!engineSpec || typeof engineSpec !== 'string') return 22
  // Try to find a number in the spec, prefer after '>=' if present
  const geMatch = engineSpec.match(/>=\s*(\d+)(?:\.\d+)?/)
  if (geMatch) return Number(geMatch[1])
  const firstMatch = engineSpec.match(/(\d+)(?:\.\d+)?/)
  if (firstMatch) return Number(firstMatch[1])
  return 22
}

let requiredMajor = 22
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const engines = pkg.engines?.node
  requiredMajor = parseRequiredMajor(engines)
} catch (_e) {
  // ignore and use default
}

const [major] = process.versions.node.split('.').map(Number)
if (major < requiredMajor) {
  console.error(
    `Node >=${requiredMajor} required (from package.json engines), found ${process.versions.node}`,
  )
  process.exit(1)
}
console.log(`Node ${process.versions.node} OK (>=${requiredMajor})`)
