// The spacing pass. It only ever rewrites the whitespace directly around an
// operator, never across a line break or a comment. Two checks keep it from
// changing what the code means: removing a space must not glue two characters
// into a longer token (`fuses`, modelled on how real compilers lex), and the
// result is parsed again and must give exactly the same tokens.

import type { Node, Tree } from "web-tree-sitter";
import type { Adapter } from "./languages.ts";
import { parserFor } from "./parser.ts";
import type { Spacing, Style } from "./style.ts";

export interface Result {
	text: string;
	changed: boolean;
	edits: number;
	// Set when the file was left untouched on purpose.
	skipped?: string;
}

export interface Edit {
	start: number;
	end: number;
	text: string;
}

// Multi-character tokens of C, C++, PHP and JS. Removing a space must never let
// two neighbouring characters fuse into one of these (a - -b -> a--b).
const fusable = new Set([
	"++", "--", "+=", "-=", "*=", "/=", "%=", ".=", "**", "->", "=>", "==", "!=", "<=", ">=",
	"<<", ">>", "&&", "||", "??", "?:", "::", "..", "/*", "//", "*/", "<?", "?>", "<>",
	"&=", "|=", "^=", "##", ".*", "<:", ":>", "<%", "%>", "%:", "!!", "<-", "?.",
]);
const word = /[\p{L}\p{N}_$]/u;
const digit = /[0-9]/;

function fuses(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (fusable.has(a + b)) return true;
	if ((a === "." && digit.test(b)) || (b === "." && digit.test(a))) return true;
	return word.test(a) && word.test(b);
}

class Pass {
	source: string;
	lang: Adapter;
	style: Style;
	groups = new Map<string, number>();
	tight: Set<string>;
	spaced: Set<string>;
	loopHeaderTight: Set<string>;
	operatorFields: Set<string>;
	edits = new Map<number, Edit>();
	conflicts = new Set<number>();

	constructor(source: string, lang: Adapter, style: Style) {
		this.source = source;
		this.lang = lang;
		this.style = style;
		this.tight = new Set(style.tight);
		this.spaced = new Set(style.spaced);
		this.loopHeaderTight = new Set(style.loopHeaderTight);
		this.operatorFields = new Set(lang.operatorFields ?? ["operator"]);
		style.contextual.forEach((group, i) => group.forEach(op => this.groups.set(op, i)));
	}

	// The operator tokens of a binary node; Python's a < b <= c has two.
	operators(node: Node): Node[] {
		const found: Node[] = [];
		for (let i=0; i<node.childCount; i++) {
			const field = node.fieldNameForChild(i);
			const child = node.child(i);
			if (child && field && this.operatorFields.has(field)) found.push(child);
		}
		return found;
	}

	run(root: Node): Edit[] {
		const stack: Node[] = [root];
		while (stack.length) {
			const node = stack.pop()!;
			if (node.type === "ERROR" || node.isMissing) continue;
			this.visit(node);
			for (let i=node.childCount - 1; i>=0; i--) {
				const child = node.child(i);
				if (child) stack.push(child);
			}
		}
		return [...this.edits.values()]
			.filter(edit => !this.conflicts.has(edit.start))
			.sort((a, b) => a.start - b.start);
	}

	visit(node: Node): void {
		const lang = this.lang;
		if (lang.functions && this.style.functionGap === "one") this.functionGaps(node);
		if (lang.blocks && this.style.braces === "attach") this.braces(node);
		if (lang.binary.has(node.type)) {
			for (const op of this.operators(node)) this.space(op, this.binary(op.type, node));
		} else if (lang.assignment.has(node.type)) {
			const op = this.assignmentToken(node);
			if (op) this.space(op, this.assignment(op.type, node));
		} else if (lang.conditional.has(node.type)) {
			this.ternary(node);
		} else if (lang.arrayArrow && node.type === lang.arrayArrow.element) {
			const arrow = node.children.find(child => child?.type === "=>");
			const array = node.parent;
			if (arrow && array && lang.arrayArrow.arrays.has(array.type)) {
				const oneLine = !this.source.slice(array.startIndex, array.endIndex).includes("\n");
				const spacing = oneLine ? this.style.arrowSingleLine : this.style.arrowMultiLine;
				if (spacing === "align") this.alignArrows(array, lang.arrayArrow.element);
				else this.space(arrow, spacing);
			}
		}
	}

	// K&R braces: a body's { moves up to the line of its header, and else,
	// catch, finally (and the while of a do-while) move up next to the }.
	// Only bodies that belong to a header (a named field of their parent):
	// a free-standing { } block, or JS code after a bare `return`, never moves.
	braces(node: Node): void {
		const first = node.child(0);
		if (first?.type === "{" && this.lang.blocks!.has(node.type) && node.parent && fieldOf(node.parent, node)) {
			this.pullUp(first, false);
		}
		for (const child of node.children) {
			if (!child || child.isNamed) continue;
			const word = child.type;
			if (word === "else" || word === "elseif" || word === "catch" || word === "finally" || (word === "while" && node.type.startsWith("do"))) {
				this.pullUp(child, true);
			}
		}
	}

	pullUp(token: Node, afterCloser: boolean): void {
		const prev = previousLeaf(token);
		if (!prev || prev.type.includes("comment")) return;
		if (afterCloser && prev.type !== "}") return;
		const src = this.source;
		const gap = src.slice(prev.endIndex, token.startIndex);
		if (!gap.includes("\n") || /\S/.test(gap)) return;
		// Never onto a preprocessor line (#if, #region): it would join the directive.
		const lineStart = src.lastIndexOf("\n", prev.endIndex - 1) + 1;
		if (src.slice(lineStart, prev.endIndex).trimStart().startsWith("#")) return;
		this.edits.set(prev.endIndex, { start: prev.endIndex, end: token.startIndex, text: " " });
	}

	// Exactly one blank line between two neighbouring function definitions.
	// Only when nothing but whitespace separates them: a comment in between
	// (a docblock) belongs to the next function and is left alone.
	functionGaps(node: Node): void {
		const functions = this.lang.functions!;
		for (let i=1; i<node.childCount; i++) {
			const prev = node.child(i - 1), next = node.child(i);
			if (!prev || !next || !functions.has(prev.type) || !functions.has(next.type)) continue;
			const current = this.source.slice(prev.endIndex, next.startIndex);
			if (/\S/.test(current) || !current.includes("\n")) continue;
			// A trailing comment can swallow the \r of a CRLF (Python's # comments
			// do): the gap then starts at the \n, the file is still CRLF, and the
			// \r already in place must not be written twice.
			const swallowed = this.source[prev.endIndex - 1] === "\r" && current.startsWith("\n");
			const eol = swallowed || current.includes("\r\n") ? "\r\n" : "\n";
			let want = eol + eol + current.slice(current.lastIndexOf("\n") + 1);
			if (swallowed) want = want.slice(1);
			if (current !== want) this.edits.set(prev.endIndex, { start: prev.endIndex, end: next.startIndex, text: want });
		}
	}

	// Lines up the => of a multi-line array in one column, one space past the
	// longest key. Only elements that start their own line, with the key and
	// the arrow on that line and the same indentation, take part.
	aligned = new Set<number>();
	alignArrows(array: Node, element: string): void {
		if (this.aligned.has(array.id)) return;
		this.aligned.add(array.id);
		const src = this.source;
		const rows: { key: Node; arrow: Node; column: number; indent: string }[] = [];
		for (const item of array.children) {
			if (!item || item.type !== element) continue;
			const arrow = item.children.find(child => child?.type === "=>");
			const key = arrow?.previousSibling;
			if (!arrow || !key || key.isExtra) continue;
			const lineStart = src.lastIndexOf("\n", item.startIndex - 1) + 1;
			const indent = src.slice(lineStart, item.startIndex);
			if (/[^ \t]/.test(indent) || src.slice(item.startIndex, arrow.startIndex).includes("\n")) continue;
			rows.push({ key, arrow, column: key.endIndex - lineStart, indent });
		}
		if (rows.length < 2 || rows.some(row => row.indent !== rows[0]!.indent)) {
			for (const row of rows) this.space(row.arrow, "spaced");
			return;
		}
		const widest = Math.max(...rows.map(row => row.column));
		for (const row of rows) {
			this.gap(row.key.endIndex, row.arrow.startIndex, " ".repeat(widest - row.column + 1));
			const next = row.arrow.nextSibling;
			if (next && !next.isExtra) this.gap(row.arrow.endIndex, next.startIndex, " ");
		}
	}

	assignmentToken(node: Node): Node | null {
		const op = node.childForFieldName("operator");
		if (op) return op;
		for (const child of node.children) {
			if (child && !child.isNamed && child.type.endsWith("=") && child.type !== "==") return child;
		}
		return null;
	}

	binary(op: string, node: Node): Spacing {
		if (this.tight.has(op)) return "tight";
		if (this.spaced.has(op)) return this.loopHeaderTight.has(op) && this.inLoopHeader(node) ? "tight" : "spaced";
		const group = this.groups.get(op);
		if (group === undefined) return "keep";
		return this.context(node, group);
	}

	// Is this operator the loosest one of its expression at statement level?
	context(node: Node, group: number): Spacing {
		const lang = this.lang;
		let n = node;
		for (;;) {
			const p = n.parent;
			if (!p) return "spaced";
			if (lang.binary.has(p.type)) {
				const parentOp = this.operators(p)[0]?.type;
				if (parentOp !== undefined && this.groups.get(parentOp) === group) {
					n = p;
					continue;
				}
				return "tight";
			}
			if (lang.grouping.has(p.type)) {
				if (p.parent && lang.structural.has(p.parent.type)) {
					n = p;
					continue;
				}
				return "tight";
			}
			if (lang.nested.has(p.type) || lang.conditional.has(p.type)) return "tight";
			const header = lang.loops.get(p.type);
			if (header) return header.has(fieldOf(p, n) ?? "") ? "tight" : "spaced";
			if (lang.transparent.has(p.type)) {
				n = p;
				continue;
			}
			return "spaced";
		}
	}

	assignment(op: string, node: Node): Spacing {
		if (op !== "=") return this.style.compoundAssignment;
		return this.inLoopHeader(node) ? this.style.assignmentInLoopHeader : this.style.assignment;
	}

	inLoopHeader(node: Node): boolean {
		let n = node;
		for (let p = n.parent; p; n = p, p = p.parent) {
			const header = this.lang.loops.get(p.type);
			if (header) return header.has(fieldOf(p, n) ?? "");
		}
		return false;
	}

	ternary(node: Node): void {
		const marks = node.children.filter(child => child && !child.isNamed && (child.type === "?" || child.type === ":")) as Node[];
		const q = marks.find(m => m.type === "?");
		const colon = marks.find(m => m.type === ":");
		// PHP's short ternary a ?: b - keep the two halves together.
		if (q && colon && q.endIndex === colon.startIndex) return;
		for (const mark of marks) this.space(mark, this.style.ternary);
	}

	// Sets the whitespace on both sides of an operator token.
	space(op: Node, spacing: Spacing): void {
		if (spacing === "keep" || spacing === "align") return; // align is handled per array
		const prev = op.previousSibling;
		const next = op.nextSibling;
		if (!prev || !next || prev.isExtra || next.isExtra) return;
		const src = this.source;
		if (spacing === "tight") {
			const text = src.slice(op.startIndex, op.endIndex);
			if (fuses(src[prev.endIndex - 1] ?? "", text[0] ?? "") || fuses(text[text.length - 1] ?? "", src[next.startIndex] ?? "")) return;
		}
		const want = spacing === "spaced" ? " " : "";
		this.gap(prev.endIndex, op.startIndex, want);
		this.gap(op.endIndex, next.startIndex, want);
	}

	gap(start: number, end: number, want: string): void {
		const current = this.source.slice(start, end);
		if (/[^ \t]/.test(current)) return; // line break, comment or anything else: leave it
		if (current === want) return;
		const existing = this.edits.get(start);
		if (existing && existing.text !== want) {
			this.conflicts.add(start);
			return;
		}
		this.edits.set(start, { start, end, text: want });
	}
}

// The token just before this one in the file, comments included.
function previousLeaf(node: Node): Node | null {
	let n: Node | null = node;
	while (n && !n.previousSibling) n = n.parent;
	let leaf = n?.previousSibling ?? null;
	while (leaf && leaf.childCount > 0) leaf = leaf.child(leaf.childCount - 1);
	return leaf;
}

function fieldOf(parent: Node, child: Node): string | null {
	for (let i=0; i<parent.childCount; i++) {
		if (parent.child(i)?.id === child.id) return parent.fieldNameForChild(i);
	}
	return null;
}

function tokens(tree: Tree): { key: string; line: number }[] {
	const out: { key: string; line: number }[] = [];
	const stack: Node[] = [tree.rootNode];
	while (stack.length) {
		const node = stack.pop()!;
		if (node.childCount === 0) {
			out.push({ key: node.type + "\u0000" + node.text, line: node.startPosition.row + 1 });
			continue;
		}
		for (let i=node.childCount - 1; i>=0; i--) {
			const child = node.child(i);
			if (child) stack.push(child);
		}
	}
	return out;
}

// The line (in a) of the first token that differs, or 0 when the streams match.
function firstDifference(a: Tree, b: Tree): number {
	const x = tokens(a);
	const y = tokens(b);
	for (let i=0; i<Math.max(x.length, y.length); i++) {
		if (x[i]?.key !== y[i]?.key) return (x[i] ?? x[x.length - 1])?.line ?? 1;
	}
	return 0;
}

function sameTokens(a: Tree, b: Tree): boolean {
	return firstDifference(a, b) === 0;
}

// The last line of defence, exported so the selftest can prove it bites.
export async function tokenizesSame(a: string, b: string, lang: Adapter): Promise<boolean> {
	const parser = await parserFor(lang);
	const x = parser.parse(a);
	const y = parser.parse(b);
	const same = x !== null && y !== null && x.rootNode.hasError === y.rootNode.hasError && sameTokens(x, y);
	x?.delete();
	y?.delete();
	parser.delete();
	return same;
}

// The edits the pass would make, before any safety check. For debugging.
export async function plan(source: string, lang: Adapter, style: Style): Promise<Edit[]> {
	const parser = await parserFor(lang);
	const tree = parser.parse(source);
	const edits = tree ? new Pass(source, lang, style).run(tree.rootNode) : [];
	tree?.delete();
	parser.delete();
	return edits;
}

export async function format(source: string, lang: Adapter, style: Style): Promise<Result> {
	const parser = await parserFor(lang);
	try {
		const tree = parser.parse(source);
		if (!tree) return { text: source, changed: false, edits: 0, skipped: "parser returned no tree" };
		const edits = new Pass(source, lang, style).run(tree.rootNode);
		if (edits.length === 0) return { text: source, changed: false, edits: 0 };
		let text = "";
		let at = 0;
		for (const edit of edits) {
			text += source.slice(at, edit.start) + edit.text;
			at = edit.end;
		}
		text += source.slice(at);
		const check = parser.parse(text);
		let skipped: string | undefined;
		if (!check) skipped = "safety check failed: the result did not parse";
		else if (check.rootNode.hasError !== tree.rootNode.hasError) skipped = "safety check failed: the result would not parse the same way";
		else {
			const line = firstDifference(tree, check);
			if (line) skipped = `safety check failed: the result would tokenize differently near line ${line}`;
		}
		tree.delete();
		check?.delete();
		if (skipped) return { text: source, changed: false, edits: 0, skipped };
		return { text, changed: text !== source, edits: edits.length };
	} finally {
		parser.delete();
	}
}
