// Spacing rules. A style says, per operator, whether it gets a space on both
// sides ("spaced"), none ("tight"), or is left as written ("keep").

export type Spacing = "tight" | "spaced" | "keep";

export interface Style {
	name: string;
	description: string;
	// Operators that are always tight / always spaced, wherever they appear.
	tight: string[];
	spaced: string[];
	// Contextual groups: an operator from a group is spaced only when it is the
	// loosest operator of its expression at statement level. Under a looser
	// operator, inside grouping parentheses, call arguments, subscripts, array
	// literals, a ternary or a for-loop header it is tight.
	contextual: string[][];
	// Operators from `spaced` that are tight inside a for-loop header anyway.
	loopHeaderTight: string[];
	compoundAssignment: Spacing;     // += -= .= ...
	assignment: Spacing;             // = outside for-loop headers
	assignmentInLoopHeader: Spacing; // = inside for (...)
	ternary: Spacing;                // ? and :
	arrowSingleLine: Spacing;        // => in an array literal written on one line
	arrowMultiLine: Spacing;         // => in an array literal spanning lines
}

export const presets: Record<string, Style> = {
	panto: {
		name: "panto",
		description: "2*a + 2*b, (a+b)*(a-b), x>0 && y<10, for (i=0; i<n; i++)",
		tight: ["*", "/", "%", ".", "**"],
		spaced: ["==", "!=", "===", "!==", "<>", "<=>", "&&", "||", "and", "or", "xor", "??"],
		contextual: [["+", "-"], ["<", ">", "<=", ">="]],
		loopHeaderTight: ["==", "!=", "===", "!=="],
		compoundAssignment: "tight",
		assignment: "spaced",
		assignmentInLoopHeader: "tight",
		ternary: "spaced",
		arrowSingleLine: "tight",
		arrowMultiLine: "keep",
	},
	classic: {
		name: "classic",
		description: "a space around every operator, as Prettier and PSR-12 do",
		tight: [],
		spaced: ["*", "/", "%", ".", "**", "==", "!=", "===", "!==", "<>", "<=>", "&&", "||", "and", "or", "xor", "??", "+", "-", "<", ">", "<=", ">="],
		contextual: [],
		loopHeaderTight: [],
		compoundAssignment: "spaced",
		assignment: "spaced",
		assignmentInLoopHeader: "spaced",
		ternary: "spaced",
		arrowSingleLine: "spaced",
		arrowMultiLine: "keep",
	},
};

export const defaultPreset = "panto";

const spacingValues = new Set(["tight", "spaced", "keep"]);

// Builds a style from a preset name plus optional overrides (from .opspace.json).
export function resolveStyle(preset: string, overrides: Record<string, unknown> = {}): Style {
	const base = presets[preset];
	if (!base) {
		throw new Error(`unknown preset "${preset}" (known: ${Object.keys(presets).join(", ")})`);
	}
	const style: Style = structuredClone(base);
	for (const [key, value] of Object.entries(overrides)) {
		if (key === "preset" || key === "$schema") continue;
		if (!(key in style) || key === "name" || key === "description") {
			throw new Error(`unknown style option "${key}"`);
		}
		const current = (style as unknown as Record<string, unknown>)[key];
		if (typeof current === "string" && !spacingValues.has(String(value))) {
			throw new Error(`"${key}" must be tight, spaced or keep`);
		}
		if (Array.isArray(current) && !Array.isArray(value)) {
			throw new Error(`"${key}" must be a list`);
		}
		(style as unknown as Record<string, unknown>)[key] = value;
	}
	return style;
}
