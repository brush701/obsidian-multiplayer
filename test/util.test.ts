// Suite: Utility functions
// Scope: Unit
// Spec: P5-S1 — Path parsing regression

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractGuidFromPath } from "../src/util";

describe("extractGuidFromPath", () => {
	it('extracts "abc-123" from "backups/abc-123/2024-01-01.json"', () => {
		expect(extractGuidFromPath("backups/abc-123/2024-01-01.json")).toBe(
			"abc-123",
		);
	});

	it('extracts "c" from "a/b/c/d.json"', () => {
		expect(extractGuidFromPath("a/b/c/d.json")).toBe("c");
	});

	it("extracts guid from standard backup path <guid>/updates", () => {
		expect(extractGuidFromPath("my-room-guid/updates")).toBe(
			"my-room-guid",
		);
	});

	it("property: for any path with >= 2 segments, returns the second-to-last segment", () => {
		const segment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/);
		fc.assert(
			fc.property(
				fc.array(segment, { minLength: 2, maxLength: 10 }),
				(segments) => {
					const path = segments.join("/");
					expect(extractGuidFromPath(path)).toBe(
						segments[segments.length - 2],
					);
				},
			),
		);
	});

	it("does not return undefined for any path with >= 2 segments", () => {
		const segment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/);
		fc.assert(
			fc.property(
				fc.array(segment, { minLength: 2, maxLength: 10 }),
				(segments) => {
					const path = segments.join("/");
					expect(extractGuidFromPath(path)).toBeDefined();
				},
			),
		);
	});
});
