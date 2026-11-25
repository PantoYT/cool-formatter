// Layout for JavaScript and TypeScript through the TypeScript language
// service, the engine behind VS Code's own JS/TS formatter. The extension uses
// it as the base formatter for those languages instead of whichever extension
// VS Code would pick, which is often Prettier, and Prettier rewrites quotes.

import ts from "typescript5";

export type LayoutSettings = ts.FormatCodeSettings;

// VS Code's defaults for javascript.format.* (read from its built-in
// typescript-language-features). The TypeScript engine treats every option
// left out as false, so these fill the gaps the same way VS Code does.
const vscodeDefaults: LayoutSettings = {
	insertSpaceAfterCommaDelimiter: true,
	insertSpaceAfterConstructor: false,
	insertSpaceAfterSemicolonInForStatements: true,
	insertSpaceBeforeAndAfterBinaryOperators: true,
	insertSpaceAfterKeywordsInControlFlowStatements: true,
	insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
	insertSpaceBeforeFunctionParenthesis: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
	insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: true,
	insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
	insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
	placeOpenBraceOnNewLineForFunctions: false,
	placeOpenBraceOnNewLineForControlBlocks: false,
	semicolons: ts.SemicolonPreference.Ignore,
	indentSwitchCase: true,
};

// File name decides the dialect: .js, .jsx, .ts or .tsx.
export function jsLayout(text: string, fileName: string, settings: LayoutSettings): string {
	const host: ts.LanguageServiceHost = {
		getScriptFileNames: () => [fileName],
		getScriptVersion: () => "1",
		getScriptSnapshot: name => name === fileName ? ts.ScriptSnapshot.fromString(text) : undefined,
		getCurrentDirectory: () => "",
		getCompilationSettings: () => ({ allowJs: true, jsx: ts.JsxEmit.Preserve }),
		getDefaultLibFileName: () => "lib.d.ts",
		fileExists: name => name === fileName,
		readFile: name => name === fileName ? text : undefined,
	};
	const service = ts.createLanguageService(host, ts.createDocumentRegistry());
	try {
		const edits = service.getFormattingEditsForDocument(fileName, { indentStyle: ts.IndentStyle.Smart, ...vscodeDefaults, ...settings });
		let out = text;
		for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start)) {
			out = out.slice(0, edit.span.start) + edit.newText + out.slice(edit.span.start + edit.span.length);
		}
		return out;
	} finally {
		service.dispose();
	}
}

// The javascript.format.* / typescript.format.* settings VS Code's formatter reads.
export const layoutSettingNames = [
	"insertSpaceAfterCommaDelimiter",
	"insertSpaceAfterConstructor",
	"insertSpaceAfterSemicolonInForStatements",
	"insertSpaceBeforeAndAfterBinaryOperators",
	"insertSpaceAfterKeywordsInControlFlowStatements",
	"insertSpaceAfterFunctionKeywordForAnonymousFunctions",
	"insertSpaceBeforeFunctionParenthesis",
	"insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis",
	"insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets",
	"insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces",
	"insertSpaceAfterOpeningAndBeforeClosingEmptyBraces",
	"insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces",
	"insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces",
	"insertSpaceAfterTypeAssertion",
	"placeOpenBraceOnNewLineForFunctions",
	"placeOpenBraceOnNewLineForControlBlocks",
	"semicolons",
	"indentSwitchCase",
] as const;
