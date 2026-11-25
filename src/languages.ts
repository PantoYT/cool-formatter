// Per-language adapters. tree-sitter already knows each language's precedence
// (it is in the shape of the tree); an adapter only names the node types the
// spacing rules care about. Adding a language means writing one of these and
// its selftest cases. `opspace tree <file>` prints the node types of a file.

export interface Adapter {
	id: string;
	grammar: string;                  // module path of the .wasm grammar
	extensions: string[];
	binary: Set<string>;              // nodes with left / operator / right
	assignment: Set<string>;          // nodes whose child token is = or a compound assignment
	conditional: Set<string>;         // ternary a ? b : c
	grouping: Set<string>;            // ( expression )
	structural: Set<string>;          // parents whose ( ) belong to the statement, as in if (...)
	nested: Set<string>;              // operands in here count as nested: arguments, subscripts, array literals
	transparent: Set<string>;         // climbed through when looking for the expression's context
	loops: Map<string, Set<string>>;  // loop node -> fields that form its header
	arrayArrow?: { element: string; arrays: Set<string> };
}

const set = (...items: string[]) => new Set(items);

const php: Adapter = {
	id: "php",
	grammar: "tree-sitter-php/tree-sitter-php.wasm",
	extensions: [".php", ".phtml", ".inc"],
	binary: set("binary_expression"),
	assignment: set("assignment_expression", "augmented_assignment_expression"),
	conditional: set("conditional_expression"),
	grouping: set("parenthesized_expression"),
	structural: set("if_statement", "else_if_clause", "while_statement", "do_statement", "switch_statement", "match_expression"),
	nested: set("arguments", "argument", "subscript_expression", "array_creation_expression", "array_element_initializer"),
	transparent: set("assignment_expression", "augmented_assignment_expression", "sequence_expression"),
	loops: new Map([["for_statement", set("initialize", "condition", "update")]]),
	arrayArrow: { element: "array_element_initializer", arrays: set("array_creation_expression") },
};

const c: Adapter = {
	id: "c",
	grammar: "tree-sitter-c/tree-sitter-c.wasm",
	extensions: [".c"],
	binary: set("binary_expression"),
	assignment: set("assignment_expression", "init_declarator"),
	conditional: set("conditional_expression"),
	grouping: set("parenthesized_expression"),
	structural: set("if_statement", "while_statement", "do_statement", "switch_statement"),
	nested: set("argument_list", "subscript_expression", "initializer_list"),
	transparent: set("assignment_expression", "init_declarator", "declaration", "comma_expression"),
	loops: new Map([["for_statement", set("initializer", "condition", "update")]]),
};

const cpp: Adapter = {
	...c,
	id: "cpp",
	grammar: "tree-sitter-cpp/tree-sitter-cpp.wasm",
	extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hh", ".hxx", ".h", ".ino"],
	nested: set("argument_list", "subscript_argument_list", "initializer_list", "template_argument_list"),
};

export const languages: Record<string, Adapter> = { php, c, cpp };

export function languageForPath(path: string): Adapter | undefined {
	const lower = path.toLowerCase();
	return Object.values(languages).find(lang => lang.extensions.some(ext => lower.endsWith(ext)));
}
