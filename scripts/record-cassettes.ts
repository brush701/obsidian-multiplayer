#!/usr/bin/env npx tsx
// Record VCR cassettes for API client integration tests.
//
// Usage:
//   npx tsx scripts/record-cassettes.ts [serverUrl] [accessToken]
//
// Example:
//   npx tsx scripts/record-cassettes.ts http://localhost:3000 eyJhbG...
//
// This script hits a live server and records the responses into
// test/integration/cassettes/. Cassettes are tagged with the server's
// reported apiVersion.
//
// Prerequisites:
//   - A running tektite-server instance
//   - A valid access token (from signing in via the plugin or OAuth flow)

import { writeFileSync } from 'fs'
import { resolve } from 'path'

const CASSETTE_DIR = resolve(__dirname, '..', 'test', 'integration', 'cassettes')

const serverUrl = process.argv[2]
const token = process.argv[3]

if (!serverUrl || !token) {
  console.error('Usage: npx tsx scripts/record-cassettes.ts <serverUrl> <accessToken>')
  console.error('Example: npx tsx scripts/record-cassettes.ts http://localhost:3000 eyJhbG...')
  process.exit(1)
}

interface CassetteSpec {
  name: string
  description: string
  method: string
  path: string
  body?: unknown
  /** Override the path with a dynamic value after recording. */
  pathReplacements?: Record<string, string>
}

// We record a subset — methods that are safe to call against a test server.
// Destructive operations (delete, revoke) are recorded with expected shapes
// from the API contract rather than live calls.
const SAFE_SPECS: CassetteSpec[] = [
  {
    name: 'getVersion',
    description: 'GET /api/version — unauthenticated version negotiation',
    method: 'GET',
    path: '/api/version',
  },
  {
    name: 'listRooms',
    description: 'GET /api/rooms — list all rooms for authenticated user',
    method: 'GET',
    path: '/api/rooms',
  },
]

async function recordCassette(
  spec: CassetteSpec,
  apiVersion: string,
  serverVersion: string,
): Promise<void> {
  const url = `${serverUrl}${spec.path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (spec.method !== 'GET' || spec.name !== 'getVersion') {
    headers['Authorization'] = `Bearer ${token}`
  }

  const fetchOpts: RequestInit = {
    method: spec.method,
    headers,
  }
  if (spec.body) {
    fetchOpts.body = JSON.stringify(spec.body)
  }

  console.log(`  Recording ${spec.name}: ${spec.method} ${spec.path}`)
  const response = await fetch(url, fetchOpts)
  const status = response.status
  let body: unknown = null
  const text = await response.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  const cassette = {
    _cassette: {
      apiVersion,
      serverVersion,
      recordedAt: new Date().toISOString(),
      description: spec.description,
    },
    request: {
      method: spec.method,
      path: spec.path,
      ...(spec.body ? { body: spec.body } : {}),
    },
    response: { status, body },
  }

  const filePath = resolve(CASSETTE_DIR, `${spec.name}.json`)
  writeFileSync(filePath, JSON.stringify(cassette, null, 2) + '\n')
  console.log(`    → ${filePath} (${status})`)
}

async function main() {
  console.log(`Recording cassettes from ${serverUrl}...\n`)

  // First, get the server version info
  const versionResp = await fetch(`${serverUrl}/api/version`)
  if (!versionResp.ok) {
    console.error(`Failed to get /api/version: ${versionResp.status}`)
    process.exit(1)
  }
  const versionInfo = (await versionResp.json()) as {
    server: string
    apiVersion: string
  }
  console.log(
    `Server: v${versionInfo.server}, API version: ${versionInfo.apiVersion}\n`,
  )

  for (const spec of SAFE_SPECS) {
    await recordCassette(spec, versionInfo.apiVersion, versionInfo.server)
  }

  console.log(
    '\nDone. Review the cassettes and update non-recordable cassettes manually.',
  )
  console.log(
    'Non-recordable cassettes (destructive ops): createRoom, deleteRoom, createInvite, revokeInvite, updateMemberRole, removeMember',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
