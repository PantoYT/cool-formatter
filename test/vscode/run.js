// Runs test/vscode/suite.cjs inside a throwaway VS Code instance: its own
// profile and extensions folder under .vscode-test/, so your settings and
// Settings Sync are never touched. Intelephense and the C/C++ extension, if
// installed, are loaded read-only from your extensions folder to act as base
// formatters.
//
// VSCODE_BIN overrides the VS Code executable, VSCODE_EXTENSIONS the folder
// searched for the base formatters.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const work = join(root, ".vscode-test");
const workspace = join(work, "workspace");
const results = join(work, "results.json");

function findCode() {
	if (process.env.VSCODE_BIN) return process.env.VSCODE_BIN;
	const finder = process.platform === "win32" ? "where.exe" : "which";
	const cli = execFileSync(finder, ["code"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
	if (process.platform === "win32") return join(dirname(cli), "..", "Code.exe"); // bin\code.cmd -> Code.exe
	return cli;
}

rmSync(work, { recursive: true, force: true });
mkdirSync(join(workspace, ".vscode"), { recursive: true });
mkdirSync(join(workspace, "classic"), { recursive: true });
writeFileSync(join(workspace, "classic", ".cool-formatter.json"), JSON.stringify({ preset: "classic" }));
const formatter = { "editor.defaultFormatter": "pantoyt.cool-formatter" };
writeFileSync(join(workspace, ".vscode", "settings.json"), JSON.stringify({
	"[php]": formatter,
	"[c]": formatter,
	"[cpp]": formatter,
	"editor.insertSpaces": false,
	"editor.tabSize": 4,
	"editor.detectIndentation": false,
	"editor.formatOnSave": true,
	"intelephense.format.braces": "k&r",
	"intelephense.telemetry.enabled": false,
	// A layout matching the panto preset: braces attached, tabs, case at switch level.
	"C_Cpp.clang_format_style": "{ BasedOnStyle: LLVM, UseTab: Always, IndentWidth: 4, TabWidth: 4, BreakBeforeBraces: Attach, ColumnLimit: 0, IndentCaseLabels: false, AllowShortIfStatementsOnASingleLine: Never, AllowShortLoopsOnASingleLine: false, AllowShortFunctionsOnASingleLine: None }",
}, null, "\t"));

const developmentPaths = [root];
const extensions = process.env.VSCODE_EXTENSIONS ?? join(homedir(), ".vscode", "extensions");
const installed = existsSync(extensions) ? readdirSync(extensions) : [];
const find = prefix => installed.filter(name => name.startsWith(prefix)).sort().pop();
const intelephense = find("bmewburn.vscode-intelephense-client-");
const cpptools = find("ms-vscode.cpptools-1");
for (const [name, folder] of [["Intelephense", intelephense], ["C/C++", cpptools]]) {
	if (folder) developmentPaths.push(join(extensions, folder));
	else console.log(`${name} not found: its base-formatter cases will be skipped`);
}

const env = {
	...process.env,
	COOL_FORMATTER_RESULTS: results,
	COOL_FORMATTER_INTELEPHENSE: intelephense ? "1" : "",
	COOL_FORMATTER_CPPTOOLS: cpptools ? "1" : "",
};
delete env.ELECTRON_RUN_AS_NODE;
const code = findCode();
console.log(`running ${code}`);
spawnSync(code, [
	...developmentPaths.map(path => `--extensionDevelopmentPath=${path}`),
	`--extensionTestsPath=${join(root, "test", "vscode", "suite.cjs")}`,
	`--user-data-dir=${join(work, "user")}`,
	`--extensions-dir=${join(work, "extensions")}`,
	"--disable-workspace-trust",
	"--skip-welcome",
	"--skip-release-notes",
	"--new-window",
	workspace,
], { stdio: "inherit", env, timeout: 180_000 });

if (!existsSync(results)) {
	console.log("no results: VS Code did not run the suite");
	process.exit(1);
}
const report = JSON.parse(readFileSync(results, "utf8"));
for (const r of report) {
	console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
	if (!r.ok || process.env.VERBOSE) console.log(`      got:  ${JSON.stringify(r.got)}\n      want: ${JSON.stringify(r.want)}`);
}
const failed = report.filter(r => !r.ok).length;
console.log(`\n${report.length - failed}/${report.length} passed`);
process.exit(failed ? 1 : 0);
