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

interface Edit {
	start: number;
	end: number;
	text: string;
}

// Multi-character tokens of C, C++, PHP and JS. Removing a space must never let
// two neighbouring characters fuse into one of these (a - -b -> a--b).
const fusable = new Set([
	"++", "--", "+=", "-=", "*=", "/=", "%=", ".=", "**", "->", "=>", "==", "!=", "<=", ">=",
	"<<", ">>", "&&", "||", "??", "?:", "::", "..", "/*", "//", "*/", "<?", "?>", "<>",
	"&=", "|=", "^=", "##", ".*", "<:", ":>", "<%", "%>", "%:", "!!",
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
	edits = new Map<number, Edit>();
	conflicts = new Set<number>();

	constructor(source: string, lang: Adapter, style: Style) {
		this.source = source;
		this.lang = lang;
		this.style = style;
		this.tight = new Set(style.tight);
		this.spaced = new Set(style.spaced);
		this.loopHeaderTight = new Set(style.loopHeaderTight);
		style.contextual.forEach((group, i) => group.forEach(op => this.groups.set(op, i)));
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
		if (lang.binary.has(node.type)) {
			const op = node.childForFieldName("operator");
			if (op) this.space(op, this.binary(op.type, node));
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
				this.space(arrow, oneLine ? this.style.arrowSingleLine : this.style.arrowMultiLine);
			}
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
				const parentOp = p.childForFieldName("operator")?.type;
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
		if (spacing === "keep") return;
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

function fieldOf(parent: Node, child: Node): string | null {
	for (let i=0; i<parent.childCount; i++) {
		if (parent.child(i)?.id === child.id) return parent.fieldNameForChild(i);
	}
	return null;
}

function tokens(tree: Tree): string[] {
	const out: string[] = [];
	const stack: Node[] = [tree.rootNode];
	while (stack.length) {
		const node = stack.pop()!;
		if (node.childCount === 0) {
			out.push(node.type + "\u0000" + node.text);
			continue;
		}
		for (let i=node.childCount - 1; i>=0; i--) {
			const child = node.child(i);
			if (child) stack.push(child);
		}
	}
	return out;
}

function sameTokens(a: Tree, b: Tree): boolean {
	const x = tokens(a);
	const y = tokens(b);
	return x.length === y.length && x.every((t, i) => t === y[i]);
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
		const safe = check !== null && check.rootNode.hasError === tree.rootNode.hasError && sameTokens(tree, check);
		tree.delete();
		check?.delete();
		if (!safe) return { text: source, changed: false, edits: 0, skipped: "safety check failed: the result would tokenize differently" };
		return { text, changed: text !== source, edits: edits.length };
	} finally {
		parser.delete();
	}
}
