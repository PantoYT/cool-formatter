// Loads web-tree-sitter and the .wasm grammars once per process.
// From the CLI the files are found in node_modules; the VS Code extension ships
// them next to its bundle and says where with `locateRuntime`.

import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { Language, Parser } from "web-tree-sitter";
import type { Adapter } from "./languages.ts";

let runtimeWasm: string | undefined;
let grammarDir: string | undefined;
let runtime: Promise<void> | null = null;
const loaded = new Map<string, Promise<Language>>();

export function locateRuntime(where: { runtimeWasm: string; grammarDir: string }): void {
	runtimeWasm = where.runtimeWasm;
	grammarDir = where.grammarDir;
}

function grammarPath(lang: Adapter): string {
	if (grammarDir) return join(grammarDir, basename(lang.grammar));
	return createRequire(import.meta.url).resolve(lang.grammar);
}

export async function parserFor(lang: Adapter): Promise<Parser> {
	runtime ??= Parser.init(runtimeWasm ? { locateFile: () => runtimeWasm! } : undefined);
	await runtime;
	let language = loaded.get(lang.id);
	if (!language) {
		language = Language.load(grammarPath(lang));
		loaded.set(lang.id, language);
	}
	const parser = new Parser();
	parser.setLanguage(await language);
	return parser;
}
