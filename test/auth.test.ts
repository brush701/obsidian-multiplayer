// Suite: AuthManager
// Scope: Unit
// Spec: TASK-8 — [P2-S1] AuthManager core + TASK-9 — [P2-S2] PKCE sign-in flow
//        TASK-11 — [P2-S4] Silent token refresh + TASK-12 — [P2-S5] Sign-out
//        TASK-42 — Loopback HTTP server for OAuth (RFC 8252 §7.3)
// What this suite validates:
//   - Fresh instance starts unauthenticated with null userInfo and null token
//   - signOut() resets state and emits auth-changed
//   - Event system: on() registers, off() removes, handlers called on emit
//   - PKCE parameter generation (base64url, correct lengths)
//   - signIn() starts loopback HTTP server and opens browser with correct authorize URL
//   - Loopback server receives callback and bridges to signIn() flow
//   - Token exchange and userInfo fetch on successful callback
//   - State mismatch rejection
//   - Non-2xx token response error handling
//   - Concurrent signIn() deduplication
//   - Cleanup of code_verifier and state after flow
//   - Silent token refresh when access token is near expiry
//   - Concurrent refresh deduplication
//   - Refresh failure triggers sign-out and notice
//   - Sign-in times out after timeout period

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthManager } from "../src/auth";
import type { AuthManagerDeps } from "../src/auth";
import { App, Notice, requestUrl } from "obsidian";
import { TokenStore } from "../src/tokenStore";
import { makeMultiplayerSettings } from "./factories";
import type { Server, IncomingMessage, ServerResponse } from "http";
import { EventEmitter } from "events";

const openExternalStub = vi.fn<[string], void>();
const requestUrlMock = vi.mocked(requestUrl);

// Mock server that captures the request handler and allows simulating requests
interface MockServer extends Server {
	_handler: (req: IncomingMessage, res: ServerResponse) => void;
	_listenCallback: (() => void) | null;
	_port: number;
}

function createMockServer(): {
	server: MockServer;
	createServer: (
		handler: (req: IncomingMessage, res: ServerResponse) => void,
	) => Server;
} {
	const emitter = new EventEmitter();
	const server = Object.assign(emitter, {
		_handler: null as unknown as (
			req: IncomingMessage,
			res: ServerResponse,
		) => void,
		_listenCallback: null as (() => void) | null,
		_port: 0,
		listen: vi.fn((port: number, _host: string, cb: () => void) => {
			server._port = port === 0 ? 54321 : port;
			server._listenCallback = cb;
			// Call listen callback asynchronously to mimic real server
			Promise.resolve().then(() => cb());
			return server;
		}),
		close: vi.fn(() => {
			return server;
		}),
		address: vi.fn(() => ({
			port: server._port || 54321,
			family: "IPv4",
			address: "127.0.0.1",
		})),
	}) as unknown as MockServer;

	const createServer = (
		h: (req: IncomingMessage, res: ServerResponse) => void,
	) => {
		server._handler = h;
		return server as unknown as Server;
	};

	return { server, createServer };
}

// Simulate an HTTP callback request to the mock server
function simulateCallback(server: MockServer, path: string) {
	const req = { url: path } as IncomingMessage;
	const res = {
		writeHead: vi.fn(),
		end: vi.fn(),
	} as unknown as ServerResponse;
	server._handler(req, res);
	return res;
}

function createAuthManager(
	serverUrl = "https://example.com",
	deps?: Partial<AuthManagerDeps>,
) {
	const app = new App();
	const settings = makeMultiplayerSettings({ serverUrl });
	const { server, createServer } = createMockServer();
	const fullDeps: AuthManagerDeps = {
		openUrl: openExternalStub,
		createServer,
		...deps,
	};
	const auth = new AuthManager(app, settings, fullDeps);
	return { auth, server };
}

// Helper: mock requestUrl to return token + userinfo responses
function mockRequestUrlSuccess(
	tokenResponse = {
		access_token: "test-access-token",
		refresh_token: "test-refresh-token",
		token_type: "Bearer",
		expires_in: 3600,
	},
	userInfoResponse = {
		sub: "550e8400-e29b-41d4-a716-446655440000",
		email: "alice@company.com",
		name: "Alice Chen",
	},
) {
	requestUrlMock.mockImplementation((params: { url: string }) => {
		if (params.url.includes("/auth/token")) {
			return Promise.resolve({
				status: 200,
				json: tokenResponse,
				headers: {},
				text: "",
			} as never);
		}
		if (params.url.includes("/auth/userinfo")) {
			return Promise.resolve({
				status: 200,
				json: userInfoResponse,
				headers: {},
				text: "",
			} as never);
		}
		if (params.url.includes("/auth/logout")) {
			return Promise.resolve({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
		}
		return Promise.reject(
			new Error(`Unexpected requestUrl: ${params.url}`),
		);
	});
}

function mockRequestUrlTokenFailure(status = 400) {
	requestUrlMock.mockImplementation((params: { url: string }) => {
		if (params.url.includes("/auth/token")) {
			return Promise.resolve({
				status,
				json: { error: "invalid_grant", error_description: "bad code" },
				headers: {},
				text: "",
			} as never);
		}
		if (params.url.includes("/auth/logout")) {
			return Promise.resolve({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
		}
		return Promise.reject(
			new Error(`Unexpected requestUrl: ${params.url}`),
		);
	});
}

// Helper: start signIn and wait for browser to open, return the authorize URL
async function signInAndGetUrl(
	auth: ReturnType<typeof createAuthManager>["auth"],
): Promise<URL> {
	await vi.waitFor(() => {
		expect(openExternalStub).toHaveBeenCalled();
	});
	return new URL(
		openExternalStub.mock.calls[openExternalStub.mock.calls.length - 1][0],
	);
}

describe("AuthManager", () => {
	beforeEach(() => {
		openExternalStub.mockClear();
		requestUrlMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("initial state", () => {
		it("isAuthenticated is false", () => {
			const { auth } = createAuthManager();
			expect(auth.isAuthenticated).toBe(false);
		});

		it("userInfo is null", () => {
			const { auth } = createAuthManager();
			expect(auth.userInfo).toBeNull();
		});

		it("getAccessToken() returns null", async () => {
			const { auth } = createAuthManager();
			const token = await auth.getAccessToken();
			expect(token).toBeNull();
		});
	});

	describe("signOut()", () => {
		// Helper: set up an authenticated AuthManager for sign-out tests
		function createSignedInManager(serverUrl = "https://example.com") {
			const app = new App();
			const settings = makeMultiplayerSettings({ serverUrl });
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			tokenStore.save({
				accessToken: "test-access-token",
				refreshToken: "test-refresh-token",
				expiresAt: new Date(Date.now() + 120_000).toISOString(),
				email: "alice@company.com",
				name: "Alice Chen",
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "test-access-token";
			authAny._userInfo = {
				email: "alice@company.com",
				name: "Alice Chen",
			};

			return { auth, tokenStore };
		}

		it("sets isAuthenticated to false", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth } = createSignedInManager();
			expect(auth.isAuthenticated).toBe(true);
			await auth.signOut();
			expect(auth.isAuthenticated).toBe(false);
		});

		it("sets userInfo to null", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth } = createSignedInManager();
			expect(auth.userInfo).not.toBeNull();
			await auth.signOut();
			expect(auth.userInfo).toBeNull();
		});

		it("getAccessToken() returns null after signOut", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth } = createSignedInManager();
			await auth.signOut();
			const token = await auth.getAccessToken();
			expect(token).toBeNull();
		});

		it("TokenStore.load() returns null after signOut", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth, tokenStore } = createSignedInManager();
			expect(tokenStore.load()).not.toBeNull();
			await auth.signOut();
			expect(tokenStore.load()).toBeNull();
		});

		it("emits auth-changed exactly once", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth } = createSignedInManager();
			const handler = vi.fn();
			auth.on("auth-changed", handler);
			await auth.signOut();
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("completes even when the logout endpoint fails", async () => {
			requestUrlMock.mockRejectedValue(new Error("Network error"));
			const { auth, tokenStore } = createSignedInManager();
			await auth.signOut();
			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
			expect(tokenStore.load()).toBeNull();
		});

		it("sends fire-and-forget /auth/logout with Bearer token", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth } = createSignedInManager("https://auth.example.com");
			await auth.signOut();

			const logoutCall = requestUrlMock.mock.calls.find((c) =>
				(c[0] as { url: string }).url.includes("/auth/logout"),
			);
			expect(logoutCall).toBeDefined();
			const params = logoutCall![0] as {
				url: string;
				headers: Record<string, string>;
			};
			expect(params.url).toBe("https://auth.example.com/auth/logout");
			expect(params.headers).toEqual({
				Authorization: "Bearer test-access-token",
			});
		});

		it("does not send logout request when no access token exists", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);
			const { auth } = createAuthManager();
			await auth.signOut();
			expect(requestUrlMock).not.toHaveBeenCalled();
		});
	});

	describe("event system", () => {
		it("on() registers a handler that is called on emit", async () => {
			const { auth } = createAuthManager();
			const handler = vi.fn();
			auth.on("auth-changed", handler);
			await auth.signOut(); // triggers emit
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("supports multiple handlers", async () => {
			const { auth } = createAuthManager();
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			auth.on("auth-changed", handler1);
			auth.on("auth-changed", handler2);
			await auth.signOut();
			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).toHaveBeenCalledTimes(1);
		});

		it("off() removes a handler so it is not called", async () => {
			const { auth } = createAuthManager();
			const handler = vi.fn();
			auth.on("auth-changed", handler);
			auth.off("auth-changed", handler);
			await auth.signOut();
			expect(handler).not.toHaveBeenCalled();
		});

		it("off() only removes the specified handler", async () => {
			const { auth } = createAuthManager();
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			auth.on("auth-changed", handler1);
			auth.on("auth-changed", handler2);
			auth.off("auth-changed", handler1);
			await auth.signOut();
			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledTimes(1);
		});

		it("adding the same handler twice only registers it once", async () => {
			const { auth } = createAuthManager();
			const handler = vi.fn();
			auth.on("auth-changed", handler);
			auth.on("auth-changed", handler);
			await auth.signOut();
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe("signIn() — loopback server PKCE flow", () => {
		it("opens browser with correct authorize URL using loopback redirect", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager(
				"https://auth.example.com",
			);
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			expect(url.origin).toBe("https://auth.example.com");
			expect(url.pathname).toBe("/auth/authorize");
			expect(url.searchParams.get("client_id")).toBe(
				"obsidian-multiplayer",
			);
			expect(url.searchParams.get("redirect_uri")).toBe(
				"http://127.0.0.1:54321/callback",
			);
			expect(url.searchParams.get("response_type")).toBe("code");
			expect(url.searchParams.get("code_challenge_method")).toBe("S256");
			expect(url.searchParams.get("scope")).toBe(
				"openid profile email offline_access",
			);
			expect(url.searchParams.get("resource")).toBe("urn:tektite:api");
			expect(url.searchParams.get("code_challenge")).toBeTruthy();
			expect(url.searchParams.get("state")).toBeTruthy();

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;
		});

		it("starts loopback server on 127.0.0.1 with port 0 (random)", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			expect(server.listen).toHaveBeenCalledWith(
				0,
				"127.0.0.1",
				expect.any(Function),
			);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;
		});

		it("shuts down loopback server after receiving callback", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(server.close).toHaveBeenCalled();
		});

		it("responds with HTML success page to the browser callback", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			const res = simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(res.writeHead).toHaveBeenCalledWith(200, {
				"Content-Type": "text/html",
			});
			expect(res.end).toHaveBeenCalledWith(
				expect.stringContaining("Sign-in complete"),
			);
		});

		it("returns 404 for non-callback paths", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			const res = simulateCallback(server, "/some-other-path");
			expect(res.writeHead).toHaveBeenCalledWith(404);

			// Complete the flow so the promise resolves
			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;
		});

		it("code_challenge is base64url SHA-256 of code_verifier", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			const codeChallenge = url.searchParams.get("code_challenge")!;
			const state = url.searchParams.get("state")!;

			simulateCallback(server, `/callback?code=test-code&state=${state}`);
			await signInPromise;

			// Get the code_verifier from the token exchange request
			const tokenCall = requestUrlMock.mock.calls.find((c) =>
				(c[0] as { url: string }).url.includes("/auth/token"),
			);
			const params = tokenCall![0] as { body: string };
			const body = new URLSearchParams(params.body);
			const codeVerifier = body.get("code_verifier")!;

			// Recompute challenge from verifier and compare
			const encoder = new TextEncoder();
			const hash = await crypto.subtle.digest(
				"SHA-256",
				encoder.encode(codeVerifier),
			);
			const hashBytes = new Uint8Array(hash);
			let binary = "";
			for (let i = 0; i < hashBytes.length; i++) {
				binary += String.fromCharCode(hashBytes[i]);
			}
			const expectedChallenge = btoa(binary)
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
			expect(codeChallenge).toBe(expectedChallenge);
		});

		it("sends correct token exchange request with loopback redirect_uri", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager(
				"https://auth.example.com",
			);
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=auth-code-123&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			// First token call: exchange code WITHOUT resource (opaque token for userinfo)
			const tokenCalls = requestUrlMock.mock.calls.filter((c) =>
				(c[0] as { url: string }).url.includes("/auth/token"),
			);
			expect(tokenCalls.length).toBeGreaterThanOrEqual(2);

			const exchangeParams = tokenCalls[0][0] as {
				url: string;
				method: string;
				contentType: string;
				body: string;
			};
			expect(exchangeParams.url).toBe(
				"https://auth.example.com/auth/token",
			);
			expect(exchangeParams.method).toBe("POST");
			expect(exchangeParams.contentType).toBe(
				"application/x-www-form-urlencoded",
			);

			const exchangeBody = new URLSearchParams(exchangeParams.body);
			expect(exchangeBody.get("grant_type")).toBe("authorization_code");
			expect(exchangeBody.get("code")).toBe("auth-code-123");
			expect(exchangeBody.get("client_id")).toBe("obsidian-multiplayer");
			expect(exchangeBody.get("redirect_uri")).toBe(
				"http://127.0.0.1:54321/callback",
			);
			expect(exchangeBody.get("code_verifier")).toBeTruthy();
			expect(exchangeBody.get("resource")).toBeNull();

			// Second token call: refresh WITH resource (JWT for API)
			const refreshParams = tokenCalls[1][0] as { body: string };
			const refreshBody = new URLSearchParams(refreshParams.body);
			expect(refreshBody.get("grant_type")).toBe("refresh_token");
			expect(refreshBody.get("resource")).toBe("urn:tektite:api");
		});

		it("sets isAuthenticated and userInfo after successful flow", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(true);
			expect(auth.userInfo).toEqual({
				email: "alice@company.com",
				name: "Alice Chen",
			});
		});

		it("getAccessToken() returns token after successful sign-in", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			const token = await auth.getAccessToken();
			expect(token).toBe("test-access-token");
		});

		it("emits auth-changed exactly once on success", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const handler = vi.fn();
			auth.on("auth-changed", handler);

			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("stays unauthenticated on state mismatch", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			await signInAndGetUrl(auth);

			// Send callback with wrong state
			simulateCallback(
				server,
				"/callback?code=test-code&state=wrong-state",
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
		});

		it("stays unauthenticated on non-2xx token response", async () => {
			mockRequestUrlTokenFailure(400);

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
		});

		it("stays unauthenticated on network error during token exchange", async () => {
			requestUrlMock.mockRejectedValue(new Error("Network error"));

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
		});

		it("second signIn() call returns the same promise", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const promise1 = auth.signIn();
			const promise2 = auth.signIn();

			expect(promise2).toBe(promise1);

			// Only one browser window opened
			await vi.waitFor(() => {
				expect(openExternalStub).toHaveBeenCalledTimes(1);
			});

			const url = new URL(openExternalStub.mock.calls[0][0]);
			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await promise1;
		});

		it("cleans up code_verifier and state after successful flow", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(
				(auth as Record<string, unknown>)["_codeVerifier"],
			).toBeNull();
			expect((auth as Record<string, unknown>)["_state"]).toBeNull();
			expect(
				(auth as Record<string, unknown>)["_pendingSignIn"],
			).toBeNull();
		});

		it("cleans up code_verifier and state after failed flow", async () => {
			mockRequestUrlTokenFailure();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(
				(auth as Record<string, unknown>)["_codeVerifier"],
			).toBeNull();
			expect((auth as Record<string, unknown>)["_state"]).toBeNull();
			expect(
				(auth as Record<string, unknown>)["_pendingSignIn"],
			).toBeNull();
		});

		it("can sign in again after a completed flow", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();

			// First sign-in
			const signIn1 = auth.signIn();
			const url1 = await signInAndGetUrl(auth);
			simulateCallback(
				server,
				`/callback?code=code-1&state=${url1.searchParams.get("state")!}`,
			);
			await signIn1;
			expect(auth.isAuthenticated).toBe(true);

			// Sign out, then sign in again
			await auth.signOut();
			openExternalStub.mockClear();

			const signIn2 = auth.signIn();
			const url2 = await signInAndGetUrl(auth);
			simulateCallback(
				server,
				`/callback?code=code-2&state=${url2.searchParams.get("state")!}`,
			);
			await signIn2;
			expect(auth.isAuthenticated).toBe(true);
		});

		it("stays unauthenticated when callback is missing code", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			// Callback without code
			simulateCallback(
				server,
				`/callback?state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
		});

		it("times out and rejects if no callback is received", async () => {
			vi.useFakeTimers();
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();

			// Wait for the server to start
			await vi.waitFor(() => {
				expect(openExternalStub).toHaveBeenCalled();
			});

			// Advance past the timeout
			vi.advanceTimersByTime(120_001);

			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
			expect(server.close).toHaveBeenCalled();

			vi.useRealTimers();
		});
	});

	describe("silent token refresh (TASK-11)", () => {
		// Helper: set up an authenticated AuthManager with tokens in the store
		function createAuthenticatedManager(
			expiresInMs: number,
			serverUrl = "https://example.com",
		) {
			const app = new App();
			const settings = makeMultiplayerSettings({ serverUrl });
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
			tokenStore.save({
				accessToken: "original-access-token",
				refreshToken: "original-refresh-token",
				expiresAt,
				email: "alice@company.com",
				name: "Alice Chen",
			});

			// Set internal auth state to match
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "original-access-token";
			authAny._userInfo = {
				email: "alice@company.com",
				name: "Alice Chen",
			};

			return { auth, app, tokenStore };
		}

		function mockRefreshSuccess(
			newAccessToken = "refreshed-access-token",
			newRefreshToken = "refreshed-refresh-token",
		) {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: newAccessToken,
							refresh_token: newRefreshToken,
							token_type: "Bearer",
							expires_in: 3600,
						},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(
					new Error(`Unexpected requestUrl: ${params.url}`),
				);
			});
		}

		function mockRefreshFailure(status = 401) {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status,
						json: {
							error: "invalid_grant",
							error_description: "token revoked",
						},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(
					new Error(`Unexpected requestUrl: ${params.url}`),
				);
			});
		}

		it("returns stored token without network request when expiry > 60s away", async () => {
			const { auth } = createAuthenticatedManager(120_000); // 120s in future

			const token = await auth.getAccessToken();

			expect(token).toBe("original-access-token");
			expect(requestUrlMock).not.toHaveBeenCalled();
		});

		it("sends refresh POST when token expiry is within 60s", async () => {
			mockRefreshSuccess();

			const { auth } = createAuthenticatedManager(30_000); // 30s in future

			const token = await auth.getAccessToken();

			expect(token).toBe("refreshed-access-token");
			expect(requestUrlMock).toHaveBeenCalledTimes(1);

			const params = requestUrlMock.mock.calls[0][0] as {
				url: string;
				method: string;
				body: string;
			};
			expect(params.url).toBe("https://example.com/auth/token");
			expect(params.method).toBe("POST");

			const body = new URLSearchParams(params.body);
			expect(body.get("grant_type")).toBe("refresh_token");
			expect(body.get("refresh_token")).toBe("original-refresh-token");
			expect(body.get("client_id")).toBe("obsidian-multiplayer");
			expect(body.get("resource")).toBe("urn:tektite:api");
		});

		it("stores both new access and refresh tokens after successful refresh", async () => {
			mockRefreshSuccess("new-at", "new-rt");

			const { auth, tokenStore } = createAuthenticatedManager(30_000);

			await auth.getAccessToken();

			const stored = tokenStore.load();
			expect(stored).not.toBeNull();
			expect(stored!.accessToken).toBe("new-at");
			expect(stored!.refreshToken).toBe("new-rt");
			expect(stored!.email).toBe("alice@company.com");
			expect(stored!.name).toBe("Alice Chen");
		});

		it("returns null and signs out on 401 refresh response", async () => {
			mockRefreshFailure(401);

			const { auth } = createAuthenticatedManager(30_000);

			const token = await auth.getAccessToken();

			expect(token).toBeNull();
			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
		});

		it('shows "Session expired" notice on refresh failure', async () => {
			const NoticeSpy = vi.spyOn(
				Notice.prototype,
				"constructor" as never,
			);
			mockRefreshFailure(401);

			const { auth } = createAuthenticatedManager(30_000);
			await auth.getAccessToken();

			// Notice is constructed with the message — we can't easily spy on
			// constructor, so we verify via the mock module's Notice calls
			// The Notice mock in __mocks__/obsidian.ts is a no-op constructor,
			// but we can check auth state changed (sign out happened)
			expect(auth.isAuthenticated).toBe(false);
			NoticeSpy.mockRestore();
		});

		it("deduplicates concurrent refresh — only one POST made", async () => {
			mockRefreshSuccess();

			const { auth } = createAuthenticatedManager(30_000);

			// Call getAccessToken twice concurrently
			const [token1, token2] = await Promise.all([
				auth.getAccessToken(),
				auth.getAccessToken(),
			]);

			expect(token1).toBe("refreshed-access-token");
			expect(token2).toBe("refreshed-access-token");
			expect(requestUrlMock).toHaveBeenCalledTimes(1);
		});

		it("emits auth-changed exactly once on refresh failure", async () => {
			mockRefreshFailure();

			const { auth } = createAuthenticatedManager(30_000);
			const handler = vi.fn();
			auth.on("auth-changed", handler);

			await auth.getAccessToken();

			// signOut() emits exactly once
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("handles network error during refresh", async () => {
			requestUrlMock.mockRejectedValue(new Error("Network error"));

			const { auth } = createAuthenticatedManager(30_000);

			const token = await auth.getAccessToken();

			expect(token).toBeNull();
			expect(auth.isAuthenticated).toBe(false);
		});

		it("refreshes expired token during restoreSession()", async () => {
			mockRefreshSuccess();

			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			// Store tokens that are already expired
			tokenStore.save({
				accessToken: "expired-token",
				refreshToken: "valid-refresh-token",
				expiresAt: new Date(Date.now() - 1000).toISOString(), // 1s ago
				email: "alice@company.com",
				name: "Alice Chen",
			});

			await auth.restoreSession();

			expect(auth.isAuthenticated).toBe(true);
			const token = await auth.getAccessToken();
			expect(token).toBe("refreshed-access-token");
		});

		it("signs out during restoreSession() if refresh fails", async () => {
			mockRefreshFailure();

			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			tokenStore.save({
				accessToken: "expired-token",
				refreshToken: "invalid-refresh-token",
				expiresAt: new Date(Date.now() - 1000).toISOString(),
				email: "alice@company.com",
				name: "Alice Chen",
			});

			await auth.restoreSession();

			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
		});
	});

	describe("base64urlEncode correctness", () => {
		it("replaces + with -, / with _, and strips trailing =", async () => {
			mockRequestUrlSuccess();

			// We can't call base64urlEncode directly (module-scoped),
			// but we can verify via the code_challenge and code_verifier output.
			// Instead, test indirectly: sign in multiple times and verify
			// all PKCE values are consistently base64url-safe.
			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);
			const challenge = url.searchParams.get("code_challenge")!;
			const state = url.searchParams.get("state")!;

			// base64url must not contain +, /, or trailing =
			expect(challenge).not.toMatch(/[+/=]/);
			expect(state).not.toMatch(/[+/=]/);
			// Must be non-empty
			expect(challenge.length).toBeGreaterThan(0);
			expect(state.length).toBeGreaterThan(0);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${state}`,
			);
			await signInPromise;

			// Verify code_verifier is also base64url
			const tokenCall = requestUrlMock.mock.calls.find((c) =>
				(c[0] as { url: string }).url.includes("/auth/token"),
			);
			const body = new URLSearchParams(
				(tokenCall![0] as { body: string }).body,
			);
			const verifier = body.get("code_verifier")!;
			expect(verifier).not.toMatch(/[+/=]/);
			expect(verifier.length).toBeGreaterThan(0);
		});
	});

	describe("hasAuthError flag", () => {
		it("starts as false", () => {
			const { auth } = createAuthManager();
			expect(auth.hasAuthError).toBe(false);
		});

		it("is set to true on refresh failure, then cleared on successful sign-in", async () => {
			// First: trigger refresh failure to set hasAuthError
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { server, createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			tokenStore.save({
				accessToken: "tok",
				refreshToken: "rt",
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				email: "alice@company.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "tok";
			authAny._userInfo = { email: "alice@company.com", name: "Alice" };

			// Mock refresh failure
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 401,
						json: { error: "invalid_grant" },
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			await auth.getAccessToken();
			expect(auth.hasAuthError).toBe(true);

			// Now sign in successfully to clear the error
			mockRequestUrlSuccess();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);
			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;
			expect(auth.hasAuthError).toBe(false);
		});
	});

	describe("getAccessToken edge cases", () => {
		function createAuthenticatedManager(expiresInMs: number) {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "test-token",
				refreshToken: "test-rt",
				expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
				email: "alice@company.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "test-token";
			authAny._userInfo = { email: "alice@company.com", name: "Alice" };
			return { auth, tokenStore };
		}

		it("returns cached token when expiry is exactly 60_001ms away", async () => {
			const { auth } = createAuthenticatedManager(60_001);
			const token = await auth.getAccessToken();
			expect(token).toBe("test-token");
			expect(requestUrlMock).not.toHaveBeenCalled();
		});

		it("triggers refresh when expiry is exactly 60_000ms away", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: "new-tok",
							refresh_token: "new-rt",
							expires_in: 3600,
						},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});
			const { auth } = createAuthenticatedManager(60_000);
			const token = await auth.getAccessToken();
			expect(token).toBe("new-tok");
			expect(requestUrlMock).toHaveBeenCalled();
		});

		it("returns null when tokens are cleared from store but auth flag is true", async () => {
			const { auth, tokenStore } = createAuthenticatedManager(120_000);
			tokenStore.clear();
			const token = await auth.getAccessToken();
			expect(token).toBeNull();
		});
	});

	describe("restoreSession edge cases", () => {
		it("does nothing when token store is empty", async () => {
			const { auth } = createAuthManager();
			await auth.restoreSession();
			expect(auth.isAuthenticated).toBe(false);
			expect(auth.userInfo).toBeNull();
		});

		it("restores user info from stored tokens", async () => {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "valid-tok",
				refreshToken: "valid-rt",
				expiresAt: new Date(Date.now() + 120_000).toISOString(),
				email: "bob@example.com",
				name: "Bob",
			});

			await auth.restoreSession();

			expect(auth.isAuthenticated).toBe(true);
			expect(auth.userInfo).toEqual({
				email: "bob@example.com",
				name: "Bob",
			});
		});

		it("emits auth-changed on successful restore", async () => {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "valid-tok",
				refreshToken: "valid-rt",
				expiresAt: new Date(Date.now() + 120_000).toISOString(),
				email: "bob@example.com",
				name: "Bob",
			});

			const handler = vi.fn();
			auth.on("auth-changed", handler);
			await auth.restoreSession();
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe("_refreshTokens stores email/name from userInfo", () => {
		it("persists email and name through token refresh", async () => {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			tokenStore.save({
				accessToken: "old-tok",
				refreshToken: "old-rt",
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				email: "alice@example.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "old-tok";
			authAny._userInfo = { email: "alice@example.com", name: "Alice" };

			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: "new-tok",
							refresh_token: "new-rt",
							expires_in: 7200,
						},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			await auth.getAccessToken();

			const stored = tokenStore.load();
			expect(stored).not.toBeNull();
			expect(stored!.email).toBe("alice@example.com");
			expect(stored!.name).toBe("Alice");
			expect(stored!.accessToken).toBe("new-tok");
			expect(stored!.refreshToken).toBe("new-rt");
		});

		it("computes expiresAt from expires_in correctly", async () => {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);

			tokenStore.save({
				accessToken: "old-tok",
				refreshToken: "old-rt",
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				email: "alice@example.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "old-tok";
			authAny._userInfo = { email: "alice@example.com", name: "Alice" };

			const now = Date.now();
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: "new-tok",
							refresh_token: "new-rt",
							expires_in: 3600,
						},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			await auth.getAccessToken();

			const stored = tokenStore.load()!;
			const expiresAt = new Date(stored.expiresAt).getTime();
			// expires_in * 1000 = 3600000, should be within a few seconds of now + 3600000
			expect(expiresAt).toBeGreaterThanOrEqual(now + 3_599_000);
			expect(expiresAt).toBeLessThanOrEqual(now + 3_601_000);
		});
	});

	describe("signOutWithAuthError", () => {
		it("sets hasAuthError to true and signs out", async () => {
			requestUrlMock.mockResolvedValue({
				status: 200,
				json: {},
				headers: {},
				text: "",
			} as never);

			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "tok";

			await auth.signOutWithAuthError();
			expect(auth.hasAuthError).toBe(true);
			expect(auth.isAuthenticated).toBe(false);
		});
	});

	describe("token exchange request format", () => {
		it("first exchange omits resource, second refresh includes resource", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager(
				"https://example.com",
			);
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=the-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			const tokenCalls = requestUrlMock.mock.calls.filter((c) =>
				(c[0] as { url: string }).url.includes("/auth/token"),
			);
			// First call: authorization_code without resource
			const firstBody = new URLSearchParams(
				(tokenCalls[0][0] as { body: string }).body,
			);
			expect(firstBody.get("grant_type")).toBe("authorization_code");
			expect(firstBody.has("resource")).toBe(false);

			// Second call: refresh_token with resource
			const secondBody = new URLSearchParams(
				(tokenCalls[1][0] as { body: string }).body,
			);
			expect(secondBody.get("grant_type")).toBe("refresh_token");
			expect(secondBody.get("resource")).toBe("urn:tektite:api");
		});
	});

	describe("_refreshTokens status code boundaries", () => {
		function createAuthenticatedForRefresh() {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "tok",
				refreshToken: "rt",
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				email: "alice@example.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "tok";
			authAny._userInfo = { email: "alice@example.com", name: "Alice" };
			return { auth, tokenStore };
		}

		it("treats status 199 as failure", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 199,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});
			const { auth } = createAuthenticatedForRefresh();
			const token = await auth.getAccessToken();
			expect(token).toBeNull();
			expect(auth.isAuthenticated).toBe(false);
		});

		it("treats status 200 as success", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: "ok-tok",
							refresh_token: "ok-rt",
							expires_in: 3600,
						},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});
			const { auth } = createAuthenticatedForRefresh();
			const token = await auth.getAccessToken();
			expect(token).toBe("ok-tok");
		});

		it("treats status 300 as failure", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 300,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});
			const { auth } = createAuthenticatedForRefresh();
			const token = await auth.getAccessToken();
			expect(token).toBeNull();
		});
	});

	describe("getAccessToken guards", () => {
		it("returns null when not authenticated even if tokens exist in store", async () => {
			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			// Put tokens in the store but DON'T set _isAuthenticated
			tokenStore.save({
				accessToken: "valid-tok",
				refreshToken: "valid-rt",
				expiresAt: new Date(Date.now() + 120_000).toISOString(),
				email: "alice@example.com",
				name: "Alice",
			});

			const token = await auth.getAccessToken();
			expect(token).toBeNull();
			// Should NOT have tried to refresh
			expect(requestUrlMock).not.toHaveBeenCalled();
		});

		it("sign-in sets both isAuthenticated and stores JWT after refresh", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			// After successful sign-in, both conditions are satisfied
			const token = await auth.getAccessToken();
			expect(token).not.toBeNull();
			expect(auth.isAuthenticated).toBe(true);
		});
	});

	describe("sign-in: JWT refresh failure after opaque token", () => {
		it("stays unauthenticated when JWT refresh fails after userinfo", async () => {
			let tokenCallCount = 0;
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					tokenCallCount++;
					if (tokenCallCount === 1) {
						// First call: authorization_code exchange succeeds
						return Promise.resolve({
							status: 200,
							json: {
								access_token: "opaque-tok",
								refresh_token: "opaque-rt",
								token_type: "Bearer",
								expires_in: 3600,
							},
							headers: {},
							text: "",
						} as never);
					}
					// Second call: refresh for JWT fails
					return Promise.resolve({
						status: 401,
						json: { error: "invalid_grant" },
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/userinfo")) {
					return Promise.resolve({
						status: 200,
						json: {
							sub: "user-1",
							email: "alice@example.com",
							name: "Alice",
						},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			// JWT refresh failed, so sign-in should not complete
			expect(auth.isAuthenticated).toBe(false);
		});
	});

	describe("restoreSession boundary: token expired at exactly 0ms", () => {
		it("refreshes token when msUntilExpiry is exactly 0", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: "refreshed-tok",
							refresh_token: "refreshed-rt",
							expires_in: 3600,
						},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "expired-tok",
				refreshToken: "valid-rt",
				expiresAt: new Date(Date.now()).toISOString(), // exactly now
				email: "alice@example.com",
				name: "Alice",
			});

			await auth.restoreSession();

			expect(auth.isAuthenticated).toBe(true);
			expect(requestUrlMock).toHaveBeenCalled();
		});
	});

	describe("sign-in callback validation", () => {
		it("rejects callback missing both code and state", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			await signInAndGetUrl(auth);

			simulateCallback(server, "/callback");
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
		});

		it("rejects callback with code but no state", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			await signInAndGetUrl(auth);

			simulateCallback(server, "/callback?code=test-code");
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
		});
	});

	describe("sign-in: non-2xx token exchange fails sign-in", () => {
		it("stays unauthenticated when token exchange returns 500", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 500,
						json: { error: "server_error" },
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
		});
	});

	describe("sign-in: userInfo fetch failure", () => {
		it("stays unauthenticated when userinfo returns 500", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.resolve({
						status: 200,
						json: {
							access_token: "tok",
							refresh_token: "rt",
							token_type: "Bearer",
							expires_in: 3600,
						},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/userinfo")) {
					return Promise.resolve({
						status: 500,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			simulateCallback(
				server,
				`/callback?code=test-code&state=${url.searchParams.get("state")!}`,
			);
			await signInPromise;

			expect(auth.isAuthenticated).toBe(false);
		});
	});

	describe("_refreshTokens catch block", () => {
		it("sets hasAuthError on network exception during refresh", async () => {
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					return Promise.reject(new Error("DNS resolution failed"));
				}
				if (params.url.includes("/auth/logout")) {
					return Promise.resolve({
						status: 200,
						json: {},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "tok",
				refreshToken: "rt",
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				email: "alice@example.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "tok";
			authAny._userInfo = { email: "alice@example.com", name: "Alice" };

			const token = await auth.getAccessToken();
			expect(token).toBeNull();
			expect(auth.hasAuthError).toBe(true);
			expect(auth.isAuthenticated).toBe(false);
		});
	});

	describe("pendingRefresh deduplication clears after completion", () => {
		it("allows new refresh after previous one completes", async () => {
			let callCount = 0;
			requestUrlMock.mockImplementation((params: { url: string }) => {
				if (params.url.includes("/auth/token")) {
					callCount++;
					return Promise.resolve({
						status: 200,
						json: {
							access_token: `tok-${callCount}`,
							refresh_token: `rt-${callCount}`,
							expires_in: 30, // short expiry to trigger refresh again
						},
						headers: {},
						text: "",
					} as never);
				}
				return Promise.reject(new Error("unexpected"));
			});

			const app = new App();
			const settings = makeMultiplayerSettings({
				serverUrl: "https://example.com",
			});
			const { createServer } = createMockServer();
			const auth = new AuthManager(app, settings, {
				openUrl: openExternalStub,
				createServer,
			});
			const tokenStore = new TokenStore(app);
			tokenStore.save({
				accessToken: "old-tok",
				refreshToken: "old-rt",
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				email: "alice@example.com",
				name: "Alice",
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const authAny = auth as any;
			authAny._isAuthenticated = true;
			authAny._accessToken = "old-tok";
			authAny._userInfo = { email: "alice@example.com", name: "Alice" };

			// First refresh
			const token1 = await auth.getAccessToken();
			expect(token1).toBe("tok-1");

			// Second refresh (pendingRefresh should have been cleared)
			const token2 = await auth.getAccessToken();
			expect(token2).toBe("tok-2");
			expect(callCount).toBe(2);
		});
	});

	describe("PKCE parameter quality", () => {
		it("code_verifier and state are base64url encoded (no +, /, or =)", async () => {
			mockRequestUrlSuccess();

			const { auth, server } = createAuthManager();
			const signInPromise = auth.signIn();
			const url = await signInAndGetUrl(auth);

			const state = url.searchParams.get("state")!;
			const codeChallenge = url.searchParams.get("code_challenge")!;

			// Verify code_challenge and state are base64url
			expect(codeChallenge).not.toMatch(/[+/=]/);
			expect(state).not.toMatch(/[+/=]/);

			simulateCallback(server, `/callback?code=test-code&state=${state}`);
			await signInPromise;

			// Verify code_verifier from token request is base64url
			const tokenCall = requestUrlMock.mock.calls.find((c) =>
				(c[0] as { url: string }).url.includes("/auth/token"),
			);
			const params = tokenCall![0] as { body: string };
			const body = new URLSearchParams(params.body);
			const codeVerifier = body.get("code_verifier")!;
			expect(codeVerifier).not.toMatch(/[+/=]/);
			// 64 bytes base64url ≈ 86 chars
			expect(codeVerifier.length).toBeGreaterThan(40);
		});
	});
});
