import type { NextConfig } from 'next'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load env from C:\june\.env (project root, outside June_APP)
// Falls back to Next.js default .env.local if file not found.
// Note: process.cwd() rather than import.meta.url — Next compiles this
// config to CommonJS, where import.meta is not defined and the build fails.
const ROOT_ENV = resolve(process.cwd(), '../../.env')
try {
  const content = readFileSync(ROOT_ENV, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = val
  }
} catch {
  // Fall back to Next.js default
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig