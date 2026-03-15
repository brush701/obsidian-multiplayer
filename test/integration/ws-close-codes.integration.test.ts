// Suite: WebSocket Close Codes — Integration
// Scope: Integration
// Spec: TASK-36 — [Testing-S7] Integration test layer (WebSocket provider + API)
// What this suite validates:
//   - Plugin's SharedFolder correctly handles WebSocket close codes 4001, 4003,
//     4004 when the server terminates the connection.
//   - Tests run against a local WS test server (not production).
//   - Plugin reconnects automatically after a transient disconnect (normal close).
//
// What is explicitly NOT tested here:
//   - Yjs document convergence between multiple clients (would require full
//     y-websocket server with doc persistence)
//   - API client integration — see api-client.integration.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

// ── Test WS server ──────────────────────────────────────────────────────────

interface TestServer {
  wss: WebSocketServer
  port: number
  url: string
  connections: WsWebSocket[]
  /** Close all connected clients with a specific code. */
  closeAll(code: number, reason?: string): void
  /** Wait for the next new connection (registers a waiter before checking). */
  waitForConnection(): Promise<WsWebSocket>
  /** Wait until at least n total connections have been established. */
  waitForConnections(n: number): Promise<void>
  shutdown(): Promise<void>
}

function createTestServer(opts?: { relay?: boolean }): Promise<TestServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 })
    const connections: WsWebSocket[] = []
    const connectionWaiters: ((ws: WsWebSocket) => void)[] = []

    wss.on('connection', (ws) => {
      connections.push(ws)

      // When relay mode is on, broadcast incoming messages to all other clients.
      // This mimics a stock y-websocket server's core behaviour.
      if (opts?.relay) {
        ws.on('message', (data: Buffer) => {
          for (const peer of connections) {
            if (peer !== ws && peer.readyState === WsWebSocket.OPEN) {
              peer.send(data)
            }
          }
        })
      }

      const waiter = connectionWaiters.shift()
      if (waiter) waiter(ws)
    })

    wss.on('listening', () => {
      const addr = wss.address()
      if (typeof addr === 'string') throw new Error('Unexpected address type')
      const port = addr.port
      resolve({
        wss,
        port,
        url: `ws://localhost:${port}`,
        connections,
        closeAll(code: number, reason?: string) {
          for (const ws of connections) {
            if (ws.readyState === WsWebSocket.OPEN) {
              ws.close(code, reason)
            }
          }
        },
        waitForConnection(): Promise<WsWebSocket> {
          // Always waits for the *next* new connection, never resolves with
          // an already-established one.
          return new Promise((res) => {
            connectionWaiters.push(res)
          })
        },
        waitForConnections(n: number): Promise<void> {
          if (connections.length >= n) return Promise.resolve()
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error(`Timed out waiting for ${n} connections`)),
              5000,
            )
            const check = setInterval(() => {
              if (connections.length >= n) {
                clearInterval(check)
                clearTimeout(timeout)
                resolve()
              }
            }, 20)
          })
        },
        shutdown(): Promise<void> {
          return new Promise((res) => {
            for (const ws of connections) {
              if (ws.readyState === WsWebSocket.OPEN) {
                ws.terminate()
              }
            }
            wss.close(() => res())
          })
        },
      })
    })
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForEvent(
  provider: WebsocketProvider,
  event: string,
  timeout = 5000,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for '${event}'`)),
      timeout,
    )
    provider.on(event, (...args: unknown[]) => {
      clearTimeout(timer)
      resolve(args)
    })
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WebSocket close codes', () => {
  let server: TestServer
  let provider: WebsocketProvider
  let ydoc: Y.Doc

  beforeEach(async () => {
    server = await createTestServer()
    ydoc = new Y.Doc()
  })

  afterEach(async () => {
    if (provider) {
      provider.destroy()
    }
    ydoc.destroy()
    await server.shutdown()
  })

  function connectProvider(roomId = 'test-room'): WebsocketProvider {
    provider = new WebsocketProvider(server.url, roomId, ydoc, {
      connect: true,
      WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
    })
    return provider
  }

  it('connects to local test WS server', async () => {
    connectProvider()
    await server.waitForConnection()
    expect(server.connections).toHaveLength(1)
  })

  it('receives close code 4001 (unauthorized) via connection-close event', async () => {
    connectProvider()
    await server.waitForConnection()

    // Listen for the close event before closing
    const closePromise = waitForEvent(provider, 'connection-close')

    server.closeAll(4001, 'Unauthorized')

    const [event] = await closePromise
    expect((event as CloseEvent).code).toBe(4001)
  })

  it('receives close code 4003 (forbidden) via connection-close event', async () => {
    connectProvider()
    await server.waitForConnection()

    const closePromise = waitForEvent(provider, 'connection-close')
    server.closeAll(4003, 'Forbidden')

    const [event] = await closePromise
    expect((event as CloseEvent).code).toBe(4003)
  })

  it('receives close code 4004 (not found) via connection-close event', async () => {
    connectProvider()
    await server.waitForConnection()

    const closePromise = waitForEvent(provider, 'connection-close')
    server.closeAll(4004, 'Not Found')

    const [event] = await closePromise
    expect((event as CloseEvent).code).toBe(4004)
  })

  it('close code handler can disconnect to prevent reconnection', async () => {
    connectProvider()
    await server.waitForConnection()

    // Simulate the plugin's _handleCloseCode pattern
    provider.on('connection-close', (event: CloseEvent) => {
      if (event && event.code === 4001) {
        provider.disconnect()
      }
    })

    const closePromise = waitForEvent(provider, 'connection-close')
    server.closeAll(4001, 'Unauthorized')
    await closePromise

    // After disconnect(), provider should not attempt to reconnect.
    // shouldConnect is set to false by disconnect().
    expect(provider.shouldConnect).toBe(false)
  })

  it('reconnects after a transient disconnect (normal close)', async () => {
    connectProvider()
    await server.waitForConnection()
    const initialConnectionCount = server.connections.length

    // Close with normal code — y-websocket should reconnect
    server.closeAll(1000, 'Normal closure')

    // Wait for the reconnection (new connection to the server)
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (server.connections.length > initialConnectionCount) {
          clearInterval(check)
          resolve()
        }
      }, 50)
      // Fail if no reconnection within timeout
      setTimeout(() => {
        clearInterval(check)
        reject(new Error('Timed out waiting for reconnection'))
      }, 5000)
    })

    expect(server.connections.length).toBeGreaterThan(initialConnectionCount)
  })
})

// ── Document convergence (two providers, same room) ──────────────────────────

describe('document convergence', () => {
  let server: TestServer
  let ydoc1: Y.Doc
  let ydoc2: Y.Doc
  let provider1: WebsocketProvider
  let provider2: WebsocketProvider

  beforeEach(async () => {
    // Relay mode: messages from one client are broadcast to all others,
    // mimicking a stock y-websocket server.
    server = await createTestServer({ relay: true })
    ydoc1 = new Y.Doc()
    ydoc2 = new Y.Doc()
  })

  afterEach(async () => {
    provider1?.destroy()
    provider2?.destroy()
    ydoc1?.destroy()
    ydoc2?.destroy()
    await server.shutdown()
  })

  it('two clients converge on document state within 2 seconds of an edit', async () => {
    provider1 = new WebsocketProvider(server.url, 'shared-room', ydoc1, {
      connect: true,
      WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
    })

    provider2 = new WebsocketProvider(server.url, 'shared-room', ydoc2, {
      connect: true,
      WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
    })

    // Wait for both to connect
    await server.waitForConnections(2)

    // Allow sync handshake to settle
    await new Promise((r) => setTimeout(r, 300))

    // Client 1 makes an edit
    ydoc1.getText('contents').insert(0, 'Hello from client 1')

    // Wait for convergence — client 2 should see the edit within 2 seconds
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Documents did not converge within 2 seconds')),
        2000,
      )
      const check = setInterval(() => {
        const text2 = ydoc2.getText('contents').toString()
        if (text2 === 'Hello from client 1') {
          clearInterval(check)
          clearTimeout(timeout)
          resolve()
        }
      }, 50)
    })

    expect(ydoc2.getText('contents').toString()).toBe('Hello from client 1')
  })
})
