// VS Code extension: a document formatter that first lets the language's own
// formatter run (Intelephense, C/C++, ...) and then fixes operator spacing.

import * as vscode from "vscode";
import { loadStyle } from "./config.ts";
import { format } from "./core.ts";
import { languages } from "./languages.ts";
import { locateRuntime } from "./parser.ts";

// VS Code language id -> adapter. Files associated with PHP (some setups map
// *.html there) go through the PHP grammar, which reads the HTML around PHP.
const adapterFor: Record<string, string> = { php: "php", c: "c", cpp: "cpp" };

// Documents whose base formatter is being asked right now. VS Code may hand
// that request back to this extension; declining makes it try the next one.
const inFlight = new Set<string>();

let output: vscode.OutputChannel;

function applyEdits(document: vscode.TextDocument, edits: readonly vscode.TextEdit[]): string {
	let text = document.getText();
	const sorted = edits
		.map(edit => ({ start: document.offsetAt(edit.range.start), end: document.offsetAt(edit.range.end), text: edit.newText }))
		.sort((a, b) => b.start - a.start);
	for (const edit of sorted) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
	return text;
}

// One edit covering only the part that changed, so the cursor, folds and
// undo history outside it stay where they were.
function minimalEdit(document: vscode.TextDocument, before: string, after: string): vscode.TextEdit[] {
	if (before === after) return [];
	const max = Math.min(before.length, after.length);
	let start = 0;
	while (start<max && before[start] === after[start]) start++;
	let end = 0;
	while (end<max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
	const range = new vscode.Range(document.positionAt(start), document.positionAt(before.length - end));
	return [vscode.TextEdit.replace(range, after.slice(start, after.length - end))];
}

const provider: vscode.DocumentFormattingEditProvider = {
	async provideDocumentFormattingEdits(document, options, token) {
		const key = document.uri.toString();
		if (inFlight.has(key)) return undefined;
		const id = adapterFor[document.languageId];
		const lang = id ? languages[id] : undefined;
		if (!lang) return undefined;
		const settings = vscode.workspace.getConfiguration("coolFormatter", document);
		const original = document.getText();
		let text = original;

		if (settings.get<string>("baseFormatter", "auto") === "auto") {
			inFlight.add(key);
			try {
				const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatDocumentProvider", document.uri, options);
				if (edits && edits.length) text = applyEdits(document, edits);
			} catch (error) {
				output.appendLine(`${document.uri.fsPath}: base formatter failed: ${(error as Error).message}`);
			} finally {
				inFlight.delete(key);
			}
		}
		if (token.isCancellationRequested) return undefined;

		let style;
		try {
			style = loadStyle(document.uri.scheme === "file" ? document.uri.fsPath : undefined, undefined, settings.get<string>("preset", "panto"));
		} catch (error) {
			vscode.window.showErrorMessage(`Cool Formatter: ${(error as Error).message}`);
			return minimalEdit(document, original, text);
		}
		const result = await format(text, lang, style);
		if (result.skipped) output.appendLine(`${document.uri.fsPath}: ${result.skipped}`);
		return minimalEdit(document, original, result.text);
	},
};

export function activate(context: vscode.ExtensionContext): void {
	locateRuntime({
		runtimeWasm: context.asAbsolutePath("dist/web-tree-sitter.wasm"),
		grammarDir: context.asAbsolutePath("dist/grammars"),
	});
	output = vscode.window.createOutputChannel("Cool Formatter");
	const selector = Object.keys(adapterFor).map(language => ({ language }));
	context.subscriptions.push(output, vscode.languages.registerDocumentFormattingEditProvider(selector, provider));
}

export function deactivate(): void {}
