import { Compartment, Extension } from "@codemirror/state";

/**
 * Manages per-document CodeMirror Compartments so that each shared document
 * gets its own isolated extension slot.  Compartments are reused across
 * open/close cycles for the same path to avoid leaking registrations
 * (Obsidian's `registerEditorExtension` has no inverse).
 */
export class DocExtensionManager {
	private _compartments = new Map<string, Compartment>();

	/**
	 * Returns the existing Compartment for `path`, or creates a new one.
	 * The caller is responsible for registering new compartments with
	 * `registerEditorExtension` and dispatching reconfigure effects.
	 */
	getOrCreate(path: string): { compartment: Compartment; isNew: boolean } {
		const existing = this._compartments.get(path);
		if (existing) return { compartment: existing, isNew: false };
		const compartment = new Compartment();
		this._compartments.set(path, compartment);
		return { compartment, isNew: true };
	}

	get(path: string): Compartment | undefined {
		return this._compartments.get(path);
	}

	/** Move a compartment from `oldPath` to `newPath`. */
	rename(oldPath: string, newPath: string): void {
		const compartment = this._compartments.get(oldPath);
		if (!compartment) return;
		this._compartments.delete(oldPath);
		this._compartments.set(newPath, compartment);
	}

	/** Iterate all compartments (e.g. to reconfigure them all to empty). */
	values(): IterableIterator<Compartment> {
		return this._compartments.values();
	}

	/**
	 * Build the reconfigure-to-empty effect for a single path.
	 * Returns `undefined` if the path has no compartment.
	 */
	emptyEffect(path: string): ReturnType<Compartment["reconfigure"]> | undefined {
		const compartment = this._compartments.get(path);
		if (!compartment) return undefined;
		return compartment.reconfigure([]);
	}

	/**
	 * Build reconfigure effects for a specific path with the given extension.
	 */
	reconfigureEffect(
		path: string,
		ext: Extension,
	): ReturnType<Compartment["reconfigure"]> | undefined {
		const compartment = this._compartments.get(path);
		if (!compartment) return undefined;
		return compartment.reconfigure(ext);
	}

	/** Number of tracked compartments. */
	get size(): number {
		return this._compartments.size;
	}

	/** Drop all entries (compartments remain registered but inert). */
	clear(): void {
		this._compartments.clear();
	}
}
