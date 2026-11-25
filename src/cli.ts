#!/usr/bin/env node
// opspace command line.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { format } from "./core.ts";
import { type Adapter, languageForPath, languages } from "./languages.ts";
import { parserFor } from "./parser.ts";
import { defaultPreset, presets, resolveStyle, type Style } from "./style.ts";

const usage = `opspace - precedence-aware operator spacing

usage:
  opspace [options] <file>...   print the formatted file (one file) to stdout
  opspace tree <file>           print the syntax tree, for writing adapters
  opspace selftest              run the built-in cases

options:
  -w, --write          rewrite the files in place
  -c, --check          list files that would change, exit 1 if any
      --stdin          read from stdin, write to stdout
      --lang <id>      ${Object.keys(languages).join(" | ")} (default: from the file extension)
      --path <file>    file name for language and config lookup with --stdin
      --preset <name>  ${Object.keys(presets).join(" | ")} (default: ${defaultPreset}, or .opspace.json)
  -h, --help

A .opspace.json in the file's folder or any parent sets the preset and
per-option overrides, e.g. {"preset": "panto", "ternary": "keep"}.`;

function fail(message: string): never {
	process.stderr.write(`opspace: ${message}\n`);
	process.exit(2);
}

function findConfig(from: string): string | null {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		const file = join(dir, ".opspace.json");
		if (existsSync(file)) return file;
		if (dirname(dir) === dir) return null;
	}
}

function styleFor(path: string | undefined, preset: string | undefined): Style {
	const config = path ? findConfig(dirname(path)) : null;
	let overrides: Record<string, unknown> = {};
	if (config) {
		try {
			overrides = JSON.parse(readFileSync(config, "utf8"));
		} catch (error) {
			fail(`${config}: ${(error as Error).message}`);
		}
	}
	try {
		return resolveStyle(preset ?? String(overrides.preset ?? defaultPreset), overrides);
	} catch (error) {
		fail(`${config ?? "--preset"}: ${(error as Error).message}`);
	}
}

function languageOf(path: string | undefined, id: string | undefined): Adapter {
	if (id) return languages[id] ?? fail(`unknown language "${id}"`);
	const lang = path ? languageForPath(path) : undefined;
	return lang ?? fail(`can't tell the language of ${path ?? "stdin"}, pass --lang`);
}

async function printTree(path: string, id: string | undefined): Promise<void> {
	const lang = languageOf(path, id);
	const tree = (await parserFor(lang)).parse(readFileSync(path, "utf8"));
	if (!tree) fail("parser returned no tree");
	const walk = (node: NonNullable<typeof tree>["rootNode"], depth: number, field: string | null): void => {
		const label = (field ? field + ": " : "") + (node.isNamed ? node.type : JSON.stringify(node.type));
		const leaf = node.childCount === 0 ? "  " + JSON.stringify(node.text) : "";
		console.log("  ".repeat(depth) + label + leaf);
		for (let i=0; i<node.childCount; i++) walk(node.child(i)!, depth + 1, node.fieldNameForChild(i));
	};
	walk(tree.rootNode, 0, null);
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			write: { type: "boolean", short: "w" },
			check: { type: "boolean", short: "c" },
			stdin: { type: "boolean" },
			lang: { type: "string" },
			path: { type: "string" },
			preset: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(usage);
		return;
	}
	if (positionals[0] === "selftest") {
		const { selftest } = await import("./selftest.ts");
		process.exit((await selftest()) ? 0 : 1);
	}
	if (positionals[0] === "tree") {
		if (!positionals[1]) fail("tree needs a file");
		return printTree(positionals[1], values.lang);
	}

	if (values.stdin) {
		const source = readFileSync(0, "utf8");
		const result = await format(source, languageOf(values.path, values.lang), styleFor(values.path, values.preset));
		if (result.skipped) process.stderr.write(`opspace: ${values.path ?? "stdin"}: ${result.skipped}\n`);
		process.stdout.write(result.text);
		return;
	}

	if (positionals.length === 0) {
		console.log(usage);
		process.exit(2);
	}
	if (!values.write && !values.check && positionals.length > 1) fail("several files need --write or --check");

	let pending = 0;
	for (const path of positionals) {
		const source = readFileSync(path, "utf8");
		const result = await format(source, languageOf(path, values.lang), styleFor(path, values.preset));
		if (result.skipped) process.stderr.write(`opspace: ${path}: ${result.skipped}\n`);
		if (values.check) {
			if (result.changed) {
				pending++;
				console.log(`${path}: ${result.edits} change${result.edits === 1 ? "" : "s"}`);
			}
		} else if (values.write) {
			if (result.changed) writeFileSync(path, result.text);
		} else {
			process.stdout.write(result.text);
		}
	}
	if (values.check && pending) process.exit(1);
}

await main();
