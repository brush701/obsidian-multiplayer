// Suite: DocExtensionManager
// Scope: Unit
// Spec: P5-S2 — Extension array regression

import { describe, it, expect } from "vitest";
import { Compartment } from "@codemirror/state";
import { DocExtensionManager } from "../src/docExtensions";

describe("DocExtensionManager", () => {
	describe("getOrCreate", () => {
		it("creates a new compartment for an unseen path", () => {
			const mgr = new DocExtensionManager();
			const { compartment, isNew } = mgr.getOrCreate("shared/a.md");
			expect(compartment).toBeInstanceOf(Compartment);
			expect(isNew).toBe(true);
			expect(mgr.size).toBe(1);
		});

		it("returns the same compartment for the same path", () => {
			const mgr = new DocExtensionManager();
			const first = mgr.getOrCreate("shared/a.md");
			const second = mgr.getOrCreate("shared/a.md");
			expect(second.compartment).toBe(first.compartment);
			expect(second.isNew).toBe(false);
			expect(mgr.size).toBe(1);
		});

		it("creates distinct compartments for different paths", () => {
			const mgr = new DocExtensionManager();
			const a = mgr.getOrCreate("shared/a.md");
			const b = mgr.getOrCreate("shared/b.md");
			expect(a.compartment).not.toBe(b.compartment);
			expect(mgr.size).toBe(2);
		});
	});

	describe("get", () => {
		it("returns undefined for unknown paths", () => {
			const mgr = new DocExtensionManager();
			expect(mgr.get("nonexistent.md")).toBeUndefined();
		});

		it("returns the compartment after getOrCreate", () => {
			const mgr = new DocExtensionManager();
			const { compartment } = mgr.getOrCreate("shared/a.md");
			expect(mgr.get("shared/a.md")).toBe(compartment);
		});
	});

	describe("rename", () => {
		it("moves a compartment from old path to new path", () => {
			const mgr = new DocExtensionManager();
			const { compartment } = mgr.getOrCreate("shared/old.md");
			mgr.rename("shared/old.md", "shared/new.md");
			expect(mgr.get("shared/old.md")).toBeUndefined();
			expect(mgr.get("shared/new.md")).toBe(compartment);
			expect(mgr.size).toBe(1);
		});

		it("is a no-op when old path does not exist", () => {
			const mgr = new DocExtensionManager();
			mgr.getOrCreate("shared/a.md");
			mgr.rename("shared/nonexistent.md", "shared/b.md");
			expect(mgr.size).toBe(1);
			expect(mgr.get("shared/b.md")).toBeUndefined();
		});
	});

	describe("emptyEffect", () => {
		it("returns undefined for unknown paths", () => {
			const mgr = new DocExtensionManager();
			expect(mgr.emptyEffect("nonexistent.md")).toBeUndefined();
		});

		it("returns a StateEffect for a known path", () => {
			const mgr = new DocExtensionManager();
			mgr.getOrCreate("shared/a.md");
			const effect = mgr.emptyEffect("shared/a.md");
			expect(effect).toBeDefined();
		});
	});

	describe("reconfigureEffect", () => {
		it("returns undefined for unknown paths", () => {
			const mgr = new DocExtensionManager();
			expect(mgr.reconfigureEffect("nonexistent.md", [])).toBeUndefined();
		});

		it("returns a StateEffect for a known path", () => {
			const mgr = new DocExtensionManager();
			mgr.getOrCreate("shared/a.md");
			const effect = mgr.reconfigureEffect("shared/a.md", []);
			expect(effect).toBeDefined();
		});
	});

	describe("values", () => {
		it("iterates all compartments", () => {
			const mgr = new DocExtensionManager();
			mgr.getOrCreate("shared/a.md");
			mgr.getOrCreate("shared/b.md");
			mgr.getOrCreate("shared/c.md");
			const all = [...mgr.values()];
			expect(all).toHaveLength(3);
			expect(all.every((c) => c instanceof Compartment)).toBe(true);
		});
	});

	describe("clear", () => {
		it("removes all entries", () => {
			const mgr = new DocExtensionManager();
			mgr.getOrCreate("shared/a.md");
			mgr.getOrCreate("shared/b.md");
			mgr.clear();
			expect(mgr.size).toBe(0);
			expect(mgr.get("shared/a.md")).toBeUndefined();
		});
	});

	describe("multi-document isolation", () => {
		it("opening 3 files and clearing the middle leaves the other two intact", () => {
			const mgr = new DocExtensionManager();
			const a = mgr.getOrCreate("shared/a.md");
			const b = mgr.getOrCreate("shared/b.md");
			const c = mgr.getOrCreate("shared/c.md");

			// "close" the middle file — the compartment is still tracked,
			// caller reconfigures it to empty via emptyEffect
			const effect = mgr.emptyEffect("shared/b.md");
			expect(effect).toBeDefined();

			// a and c should still be retrievable with the same identity
			expect(mgr.get("shared/a.md")).toBe(a.compartment);
			expect(mgr.get("shared/c.md")).toBe(c.compartment);
			expect(mgr.size).toBe(3);
		});

		it("reopening a previously closed file reuses its compartment", () => {
			const mgr = new DocExtensionManager();
			const first = mgr.getOrCreate("shared/a.md");

			// "close" — reconfigure to empty
			mgr.emptyEffect("shared/a.md");

			// "reopen"
			const second = mgr.getOrCreate("shared/a.md");
			expect(second.compartment).toBe(first.compartment);
			expect(second.isNew).toBe(false);
		});
	});
});
