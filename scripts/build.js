// Bundles the VS Code extension into dist/ together with the .wasm files it loads.

import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { languages } from "../src/languages.ts";

const require = createRequire(import.meta.url);

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/grammars", { recursive: true });
copyFileSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm"), "dist/web-tree-sitter.wasm");
for (const lang of Object.values(languages)) {
	copyFileSync(require.resolve(lang.grammar), join("dist/grammars", basename(lang.grammar)));
}

await build({
	entryPoints: ["src/extension.ts"],
	outfile: "dist/extension.cjs",
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node20",
	external: ["vscode"],
	minify: true,
	// The extension tells the parser where the .wasm files are, so the
	// node_modules lookup through import.meta.url is never reached.
	define: { "import.meta.url": "undefined" },
	plugins: [{
		// Use web-tree-sitter's CommonJS build; its ES module build finds
		// files through import.meta.url, which a CommonJS bundle lacks.
		name: "web-tree-sitter-cjs",
		setup(b) {
			b.onResolve({ filter: /^web-tree-sitter$/ }, () => ({ path: require.resolve("web-tree-sitter") }));
		},
	}],
	logLevel: "warning",
});
console.log("dist/ ready");
