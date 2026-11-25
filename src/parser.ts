// Loads web-tree-sitter and the .wasm grammars once per process.

import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import type { Adapter } from "./languages.ts";

const require = createRequire(import.meta.url);

let runtime: Promise<void> | null = null;
const loaded = new Map<string, Promise<Language>>();

export async function parserFor(lang: Adapter): Promise<Parser> {
	runtime ??= Parser.init();
	await runtime;
	let language = loaded.get(lang.id);
	if (!language) {
		language = Language.load(require.resolve(lang.grammar));
		loaded.set(lang.id, language);
	}
	const parser = new Parser();
	parser.setLanguage(await language);
	return parser;
}
