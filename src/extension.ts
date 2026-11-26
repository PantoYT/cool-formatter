// VS Code extension: a formatter for every language. Languages it knows get a
// layout pass (VS Code's JS engine, or the language's formatter extension) and
// then its own spacing and brace pass; every other language is handed on to
// whichever formatter VS Code has for it, so one editor.defaultFormatter line
// covers everything.

import * as vscode from "vscode";
import { loadStyle } from "./config.ts";
import { format } from "./core.ts";
import { jsLayout, type LayoutSettings, layoutSettingNames } from "./jslayout.ts";
import { languages } from "./languages.ts";
import { locateRuntime } from "./parser.ts";
import type { Style } from "./style.ts";

const extensionId = "panto.cool-formatter";

// Adapter -> file extension that tells the TypeScript engine the dialect.
const jsDialect: Record<string, string> = { js: ".jsx", ts: ".ts", tsx: ".tsx" };

// VS Code language id -> adapter. Files associated with PHP (some setups map
// *.html there) go through the PHP grammar, which reads the HTML around PHP.
const adapterFor: Record<string, string> = {
	php: "php",
	c: "c",
	cpp: "cpp",
	javascript: "js",
	javascriptreact: "js",
	typescript: "ts",
	typescriptreact: "tsx",
	csharp: "cs",
	java: "java",
	python: "py",
	rust: "rs",
};

// The javascript.format.* / typescript.format.* settings. A value the user set
// wins, then the preset's (semicolons and case placement travel with the
// style), then VS Code's own default.
function jsLayoutSettings(document: vscode.TextDocument, options: vscode.FormattingOptions, style: Style): LayoutSettings {
	const section = document.languageId.startsWith("typescript") ? "typescript.format" : "javascript.format";
	const config = vscode.workspace.getConfiguration(section, document);
	const settings: Record<string, unknown> = {
		tabSize: options.tabSize,
		indentSize: options.tabSize,
		convertTabsToSpaces: options.insertSpaces,
		newLineCharacter: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
	};
	for (const name of layoutSettingNames) {
		const seen = config.inspect(name);
		const chosen = [seen?.workspaceFolderLanguageValue, seen?.workspaceLanguageValue, seen?.globalLanguageValue,
			seen?.workspaceFolderValue, seen?.workspaceValue, seen?.globalValue].find(value => value !== undefined);
		const value = chosen ?? style.jsLayout[name] ?? seen?.defaultValue;
		if (value !== undefined) settings[name] = value;
	}
	return settings as LayoutSettings;
}

// Documents whose base formatter is being asked right now. VS Code hands that
// request back to this extension too; declining makes it try the next one.
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

// The edits of the other formatter VS Code has for this document, if any.
async function otherFormatter(document: vscode.TextDocument, options: vscode.FormattingOptions): Promise<vscode.TextEdit[] | undefined> {
	const key = document.uri.toString();
	inFlight.add(key);
	try {
		return await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatDocumentProvider", document.uri, options);
	} catch (error) {
		output.appendLine(`${document.uri.fsPath}: other formatter failed: ${(error as Error).message}`);
		return undefined;
	} finally {
		inFlight.delete(key);
	}
}

const provider: vscode.DocumentFormattingEditProvider = {
	async provideDocumentFormattingEdits(document, options, token) {
		if (inFlight.has(document.uri.toString())) return undefined;
		const settings = vscode.workspace.getConfiguration("coolFormatter", document);
		const base = settings.get<string>("baseFormatter", "auto");
		const id = adapterFor[document.languageId];
		const lang = id ? languages[id] : undefined;

		// A language without an adapter: pass it on (HTML, CSS, JSON, ...).
		if (!lang) return base === "none" ? undefined : otherFormatter(document, options);

		let style: Style;
		try {
			style = loadStyle(document.uri.scheme === "file" ? document.uri.fsPath : undefined, undefined, settings.get<string>("preset", "panto"));
		} catch (error) {
			vscode.window.showErrorMessage(`Cool Formatter: ${(error as Error).message}`);
			return undefined;
		}

		const original = document.getText();
		let text = original;
		if (base === "auto" && jsDialect[lang.id]) {
			// JS/TS: VS Code's own formatting engine, so the result does not depend
			// on which other formatter is installed (Prettier rewrites quotes).
			try {
				text = jsLayout(original, `file${jsDialect[lang.id]}`, jsLayoutSettings(document, options, style));
			} catch (error) {
				output.appendLine(`${document.uri.fsPath}: JS layout failed: ${(error as Error).message}`);
			}
		} else if (base === "auto" || base === "extension") {
			const edits = await otherFormatter(document, options);
			if (edits && edits.length) text = applyEdits(document, edits);
		}
		if (token.isCancellationRequested) return undefined;

		const result = await format(text, lang, style);
		if (result.skipped) output.appendLine(`${document.uri.fsPath}: ${result.skipped}`);
		return minimalEdit(document, original, result.text);
	},
};

// Makes this the default formatter of every language in the user settings,
// optionally with format on save. Language-specific choices stay as they are.
async function useEverywhere(formatOnSave: boolean): Promise<void> {
	const editor = vscode.workspace.getConfiguration("editor");
	await editor.update("defaultFormatter", extensionId, vscode.ConfigurationTarget.Global);
	if (formatOnSave) await editor.update("formatOnSave", true, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage(`Cool Formatter now formats every language${formatOnSave ? ", on save" : ""}.`);
}

async function offerOnce(context: vscode.ExtensionContext): Promise<void> {
	const asked = "coolFormatter.askedToUseEverywhere";
	if (context.globalState.get(asked)) return;
	if (vscode.workspace.getConfiguration("editor").inspect("defaultFormatter")?.globalValue === extensionId) return;
	await context.globalState.update(asked, true);
	const everywhere = "Every language";
	const onSave = "Every language, on save";
	const choice = await vscode.window.showInformationMessage(
		"Use Cool Formatter as the formatter for every language? Languages it does not know are passed on to their usual formatter.",
		everywhere, onSave, "Not now");
	if (choice === everywhere) await useEverywhere(false);
	if (choice === onSave) await useEverywhere(true);
}

export function activate(context: vscode.ExtensionContext): void {
	locateRuntime({
		runtimeWasm: context.asAbsolutePath("dist/web-tree-sitter.wasm"),
		grammarDir: context.asAbsolutePath("dist/grammars"),
	});
	output = vscode.window.createOutputChannel("Cool Formatter");
	context.subscriptions.push(
		output,
		vscode.languages.registerDocumentFormattingEditProvider("*", provider),
		vscode.commands.registerCommand("coolFormatter.useEverywhere", () => useEverywhere(true)),
	);
	void offerOnce(context);
}

export function deactivate(): void {}
