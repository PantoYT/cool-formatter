// Finds .cool-formatter.json next to a file or in any parent folder and turns
// it into a style. Shared by the CLI and the VS Code extension.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defaultPreset, resolveStyle, type Style } from "./style.ts";

export const configFileName = ".cool-formatter.json";

export function findConfig(from: string): string | null {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		const file = join(dir, configFileName);
		if (existsSync(file)) return file;
		if (dirname(dir) === dir) return null;
	}
}

// `forced` (the CLI's --preset) beats the config file, which beats `fallback`
// (the editor setting). Throws with the config file's path in the message.
export function loadStyle(filePath: string | undefined, forced?: string, fallback: string = defaultPreset): Style {
	const config = filePath ? findConfig(dirname(filePath)) : null;
	let overrides: Record<string, unknown> = {};
	try {
		if (config) overrides = JSON.parse(readFileSync(config, "utf8"));
		return resolveStyle(forced ?? (typeof overrides.preset === "string" ? overrides.preset : fallback), overrides);
	} catch (error) {
		throw new Error(`${config ?? "preset"}: ${(error as Error).message}`);
	}
}
