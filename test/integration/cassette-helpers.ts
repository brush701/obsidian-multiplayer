// Cassette loading and nock setup helpers for VCR-style integration tests.
//
// Each cassette is a JSON file in test/integration/cassettes/ with:
//   _cassette.apiVersion — server API contract version tag
//   request — { method, path, body? }
//   response — { status, body }

import nock from 'nock'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

const CASSETTE_DIR = resolve(__dirname, 'cassettes')

export interface Cassette {
  _cassette: {
    apiVersion: string
    serverVersion: string
    recordedAt: string
    description: string
  }
  request: {
    method: string
    path: string
    body?: unknown
  }
  response: {
    status: number
    body: unknown
  }
}

/** Load a cassette JSON file by name (without extension). */
export function loadCassette(name: string): Cassette {
  const raw = readFileSync(resolve(CASSETTE_DIR, `${name}.json`), 'utf-8')
  return JSON.parse(raw)
}

/**
 * Set up a nock interceptor from a cassette.
 * Returns the nock scope for assertion (e.g. scope.isDone()).
 */
export function playCassette(baseUrl: string, name: string): nock.Scope {
  const cassette = loadCassette(name)
  const scope = nock(baseUrl)

  const { method, path, body } = cassette.request
  const { status, body: responseBody } = cassette.response

  let interceptor: nock.Interceptor
  switch (method) {
    case 'GET':
      interceptor = scope.get(path)
      break
    case 'POST':
      interceptor = scope.post(path, body as nock.RequestBodyMatcher)
      break
    case 'PUT':
      interceptor = scope.put(path, body as nock.RequestBodyMatcher)
      break
    case 'DELETE':
      interceptor = scope.delete(path)
      break
    default:
      throw new Error(`Unsupported HTTP method in cassette: ${method}`)
  }

  if (responseBody === null) {
    interceptor.reply(status)
  } else {
    interceptor.reply(status, responseBody)
  }

  return scope
}

/**
 * A requestUrl adapter that uses Node's global fetch, matching Obsidian's
 * RequestUrlResponse shape. This lets TektiteApiClient make real HTTP calls
 * (intercepted by nock) instead of using Obsidian's native requestUrl.
 */
export async function fetchRequestUrl(
  params: RequestUrlParam,
): Promise<RequestUrlResponse> {
  const { url, method = 'GET', headers, body, contentType } = params

  const fetchHeaders: Record<string, string> = { ...(headers as Record<string, string>) }
  if (contentType) {
    fetchHeaders['Content-Type'] = contentType
  }

  const response = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: body ?? undefined,
  })

  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    json,
    arrayBuffer: new ArrayBuffer(0),
  } as RequestUrlResponse
}
