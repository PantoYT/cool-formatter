// Runs inside the VS Code extension host started by run.js.

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

const results = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));

function check(name, got, want) {
	results.push({ name, ok: got === want, got, want });
}

function contains(name, text, part) {
	results.push({ name, ok: text.includes(part), got: text, want: `contains ${part}` });
}

async function open(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	await vscode.window.showTextDocument(doc);
	return doc;
}

async function formatted(file, content) {
	const doc = await open(file, content);
	await vscode.commands.executeCommand("editor.action.formatDocument");
	return doc.getText();
}

// Base formatters register only once their servers are up. The probe file has
// no operators, so any edit at all means the base formatter answered.
async function waitForBase(file, probe) {
	const doc = await open(file, probe);
	for (let i=0; i<120; i++) {
		const edits = await vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", doc.uri, { insertSpaces: false, tabSize: 4 });
		if (edits && edits.length) return true;
		await sleep(500);
	}
	return false;
}

exports.run = async function () {
	const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
	try {
		await vscode.extensions.getExtension("panto.cool-formatter").activate();

		const cpp = "int main()\n{\n    for (int i = 0; i < n; i++) x = a * b - c;\n}\n";
		if (process.env.COOL_FORMATTER_CPPTOOLS) {
			check("C/C++ extension came up", await waitForBase(path.join(ws, "ready.cpp"), "int f()\n{\nreturn 1;\n}\n"), true);
			check("C++: clang-format first, then the operators",
				await formatted(path.join(ws, "a.cpp"), cpp),
				"int main() {\n\tfor (int i=0; i<n; i++)\n\t\tx = a*b - c;\n}\n");
		} else {
			check("C++ without a base formatter",
				await formatted(path.join(ws, "a.cpp"), cpp),
				"int main()\n{\n    for (int i=0; i<n; i++) x = a*b - c;\n}\n");
		}

		// JS: VS Code's own formatter first (Prettier is disabled for JS in the
		// workspace and must not run: it would turn 'a' into "a"), then the operators.
		const js = await formatted(path.join(ws, "a.js"), "function f(a)\n{\n    for (let i = 0; i < n; i++) y = a * b - c\n    return 'a' + b\n}\n");
		contains("JS: quotes left as written", js, "'a'");
		contains("JS: built-in formatter added semicolons", js, "y = a*b - c;");
		contains("JS: brace on the same line", js, "function f(a) {");
		contains("JS: for header tight", js, "for (let i=0; i<n; i++)");

		check("Java without a base formatter",
			await formatted(path.join(ws, "A.java"), "class A { int f() { return (a + b) * 2; } }\n"),
			"class A { int f() { return (a+b)*2; } }\n");

		check(".cool-formatter.json picks the classic preset",
			await formatted(path.join(ws, "classic", "b.php"), "<?php\n$p = ($a+$b)*($a-$b);\n"),
			"<?php\n$p = ($a + $b) * ($a - $b);\n");

		const doc = await open(path.join(ws, "c.php"), "<?php\n$x = 1;\n");
		await doc.save();
		const editor = vscode.window.activeTextEditor;
		await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), "<?php\n$x = $a * 2 + 1;\n"));
		await doc.save();
		check("format on save", doc.getText().includes("$x = $a*2 + 1;"), true);

		if (process.env.COOL_FORMATTER_INTELEPHENSE) {
			const ready = await waitForBase(path.join(ws, "ready.php"), "<?php\nfunction f()\n{\nreturn 1;\n}\n");
			check("Intelephense came up", ready, true);
			const text = await formatted(path.join(ws, "d.php"),
				"<?php\nfunction srednia(array $zmienne)\n{\n$suma = 0;\nforeach ($zmienne as $z) {\n$suma += $z;\n}\nreturn $suma / count($zmienne);\n}\n");
			contains("Intelephense ran first: k&r brace", text, "function srednia(array $zmienne) {");
			contains("Intelephense ran first: indentation", text, "\n\t$suma = 0;");
			contains("then the operators: compound", text, "$suma+=$z;");
			contains("then the operators: division", text, "return $suma/count($zmienne);");

			await vscode.workspace.getConfiguration("coolFormatter").update("baseFormatter", "none", vscode.ConfigurationTarget.Workspace);
			await sleep(300);
			check("baseFormatter none skips Intelephense",
				await formatted(path.join(ws, "e.php"), "<?php\nfunction f()\n{\nreturn $a * 2;\n}\n"),
				"<?php\nfunction f()\n{\nreturn $a*2;\n}\n");
		}
	} catch (error) {
		results.push({ name: "suite crashed", ok: false, got: String(error && error.stack || error), want: "no exception" });
	} finally {
		fs.writeFileSync(process.env.COOL_FORMATTER_RESULTS, JSON.stringify(results, null, 1));
	}
};
