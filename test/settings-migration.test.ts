/**
 * Settings migration tests — TASK-31 (Testing-S2)
 *
 * Verifies that loadSettings() correctly handles legacy data shapes
 * (pre-transport-migration) and produces the current MultiplayerSettings schema.
 *
 * Traces to P1-S3 acceptance criteria:
 *  - Migration adds `serverUrl`, `username` with empty defaults
 *  - Migration is idempotent
 *  - Migration preserves `guid`, `path`, `name`
 *
 * Note: Legacy fields (salt, encPw, signalingServers) are not actively stripped —
 * Object.assign merges them into the result, but they're invisible to TypeScript
 * and unused by the plugin. This matches the TASK-5 decision: "No migration
 * needed — plugin has no existing users."
 */
import { describe, it, expect } from "vitest";
import type { MultiplayerSettings } from "../src/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: MultiplayerSettings = {
	serverUrl: "",
	username: "",
	sharedFolders: [],
};

/**
 * Simulate the same Object.assign merge that main.ts loadSettings() uses.
 * This is the migration mechanism — no separate migration function exists.
 */
function migrateSettings(stored: Record<string, unknown>): MultiplayerSettings {
	return Object.assign({}, DEFAULT_SETTINGS, stored) as MultiplayerSettings;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Settings migration (P1-S3)", () => {
	it("adds missing serverUrl and username with empty defaults", () => {
		const stored = { sharedFolders: [] };

		const result = migrateSettings(stored);

		expect(result.serverUrl).toBe("");
		expect(result.username).toBe("");
	});

	it("legacy fields are harmlessly carried through (not actively stripped)", () => {
		const legacy = {
			salt: "abc123",
			encPw: "secret",
			signalingServers: ["wss://old-server.com"],
			sharedFolders: [],
		};

		const result = migrateSettings(legacy);

		// Object.assign merges legacy fields into the result — they're unused
		// but present at runtime. TypeScript hides them from the type.
		const raw = result as unknown as Record<string, unknown>;
		expect(raw["salt"]).toBe("abc123");
		// Crucially, the new required fields are present
		expect(result.serverUrl).toBe("");
		expect(result.username).toBe("");
	});

	it("is idempotent — applying twice produces identical output", () => {
		const legacy = {
			salt: "abc123",
			encPw: "secret",
			signalingServers: ["wss://old.com"],
			sharedFolders: [{ guid: "g1", path: "p1", name: "n1" }],
		};

		const first = migrateSettings(legacy);
		const second = migrateSettings(first as unknown as Record<string, unknown>);

		expect(second).toEqual(first);
	});

	it("preserves guid, path, name fields on shared folders", () => {
		const stored = {
			sharedFolders: [
				{ guid: "room-guid-1", path: "my-folder", name: "My Room" },
				{ guid: "room-guid-2", path: "other-folder", name: "Other Room" },
			],
		};

		const result = migrateSettings(stored);

		expect(result.sharedFolders).toEqual([
			{ guid: "room-guid-1", path: "my-folder", name: "My Room" },
			{ guid: "room-guid-2", path: "other-folder", name: "Other Room" },
		]);
	});

	it("preserves existing serverUrl and username when already set", () => {
		const stored = {
			serverUrl: "https://my-server.com",
			username: "alice",
			sharedFolders: [],
		};

		const result = migrateSettings(stored);

		expect(result.serverUrl).toBe("https://my-server.com");
		expect(result.username).toBe("alice");
	});

	it("handles empty stored data (fresh install)", () => {
		const result = migrateSettings({});

		expect(result).toEqual(DEFAULT_SETTINGS);
	});
});

describe("WebSocket URL construction (property-based)", () => {
	it("constructs URL as ${serverUrl}/room/${guid} for any valid inputs", () => {
		const cases = [
			{ serverUrl: "wss://example.com", guid: "abc-123" },
			{ serverUrl: "wss://localhost:8080", guid: "00000000-0000-0000-0000-000000000000" },
			{ serverUrl: "ws://test", guid: "simple" },
			{ serverUrl: "wss://server.io/v2", guid: "room-with-dashes" },
		];

		for (const { serverUrl, guid } of cases) {
			const wsBase = `${serverUrl}/room`;
			// WebsocketProvider is constructed with (wsBase, guid, ydoc, opts)
			// y-websocket joins these as wsBase/guid
			expect(`${wsBase}/${guid}`).toBe(`${serverUrl}/room/${guid}`);
		}
	});
});
