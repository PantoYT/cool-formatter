// Per-language adapters. tree-sitter already knows each language's precedence
// (it is in the shape of the tree); an adapter only names the node types the
// spacing rules care about. Adding a language means writing one of these and
// its selftest cases. `cool-formatter tree <file>` prints the node types of a file.

export interface Adapter {
	id: string;
	grammar: string;                  // module path of the .wasm grammar
	extensions: string[];
	binary: Set<string>;              // nodes with left / operator / right
	operatorFields?: string[];        // fields holding the operator token(s); default ["operator"]
	assignment: Set<string>;          // nodes whose child token is = or a compound assignment
	conditional: Set<string>;         // ternary a ? b : c
	grouping: Set<string>;            // ( expression )
	structural: Set<string>;          // parents whose ( ) belong to the statement, as in if (...)
	nested: Set<string>;              // operands in here count as nested: arguments, subscripts, array literals
	transparent: Set<string>;         // climbed through when looking for the expression's context
	loops: Map<string, Set<string>>;  // loop node -> fields that form its header
	arrayArrow?: { element: string; arrays: Set<string> };
	functions?: Set<string>;          // definitions that get one blank line between them
	blocks?: Set<string>;             // bodies whose { can move up to the line of their header
}

const set = (...items: string[]) => new Set(items);
const none = new Map<string, Set<string>>();

const php: Adapter = {
	id: "php",
	blocks: set("compound_statement", "declaration_list", "enum_declaration_list", "switch_block", "match_block"),
	functions: set("function_definition", "method_declaration"),
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
	blocks: set("compound_statement", "field_declaration_list", "enumerator_list"),
	functions: set("function_definition"),
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
	blocks: set("compound_statement", "field_declaration_list", "enumerator_list", "declaration_list"),
	functions: set("function_definition", "template_declaration"),
	grammar: "tree-sitter-cpp/tree-sitter-cpp.wasm",
	extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hh", ".hxx", ".h", ".ino"],
	nested: set("argument_list", "subscript_argument_list", "initializer_list", "template_argument_list"),
};

const js: Adapter = {
	id: "js",
	blocks: set("statement_block", "class_body", "switch_body"),
	functions: set("function_declaration", "generator_function_declaration", "method_definition"),
	grammar: "tree-sitter-javascript/tree-sitter-javascript.wasm",
	extensions: [".js", ".mjs", ".cjs", ".jsx"],
	binary: set("binary_expression"),
	assignment: set("assignment_expression", "augmented_assignment_expression", "variable_declarator"),
	conditional: set("ternary_expression"),
	grouping: set("parenthesized_expression"),
	structural: set("if_statement", "while_statement", "do_statement", "switch_statement", "with_statement"),
	nested: set("arguments", "subscript_expression", "array", "object", "pair", "template_substitution", "jsx_expression", "spread_element"),
	transparent: set("assignment_expression", "augmented_assignment_expression", "variable_declarator", "lexical_declaration", "variable_declaration", "sequence_expression"),
	loops: new Map([["for_statement", set("initializer", "condition", "increment")]]),
};

const ts: Adapter = {
	...js,
	id: "ts",
	grammar: "tree-sitter-typescript/tree-sitter-typescript.wasm",
	extensions: [".ts", ".mts", ".cts"],
};

const tsx: Adapter = {
	...js,
	id: "tsx",
	grammar: "tree-sitter-typescript/tree-sitter-tsx.wasm",
	extensions: [".tsx"],
};

const cs: Adapter = {
	id: "cs",
	blocks: set("block", "declaration_list", "enum_member_declaration_list", "switch_body", "accessor_list"),
	functions: set("method_declaration", "constructor_declaration", "local_function_statement"),
	grammar: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
	extensions: [".cs"],
	binary: set("binary_expression"),
	assignment: set("assignment_expression", "variable_declarator"),
	conditional: set("conditional_expression"),
	grouping: set("parenthesized_expression"),
	structural: set("if_statement", "while_statement", "do_statement", "switch_statement", "lock_statement"),
	nested: set("argument_list", "argument", "bracketed_argument_list", "initializer_expression", "interpolation"),
	transparent: set("assignment_expression", "variable_declarator", "variable_declaration"),
	loops: new Map([["for_statement", set("initializer", "condition", "update")]]),
};

const java: Adapter = {
	id: "java",
	blocks: set("block", "class_body", "interface_body", "enum_body", "switch_block", "constructor_body"),
	functions: set("method_declaration", "constructor_declaration"),
	grammar: "tree-sitter-java/tree-sitter-java.wasm",
	extensions: [".java"],
	binary: set("binary_expression"),
	assignment: set("assignment_expression", "variable_declarator"),
	conditional: set("ternary_expression"),
	grouping: set("parenthesized_expression"),
	structural: set("if_statement", "while_statement", "do_statement", "switch_expression", "synchronized_statement"),
	nested: set("argument_list", "array_access", "array_initializer", "dimensions_expr"),
	transparent: set("assignment_expression", "variable_declarator", "local_variable_declaration"),
	loops: new Map([["for_statement", set("init", "condition", "update")]]),
};

const py: Adapter = {
	id: "py",
	functions: set("function_definition", "decorated_definition"),
	grammar: "tree-sitter-python/tree-sitter-python.wasm",
	extensions: [".py", ".pyi", ".pyw"],
	// a < b <= c is one comparison node with several operators.
	binary: set("binary_operator", "comparison_operator", "boolean_operator"),
	operatorFields: ["operator", "operators"],
	assignment: set("assignment", "augmented_assignment"),
	conditional: set("conditional_expression"),
	grouping: set("parenthesized_expression"),
	structural: set("if_statement", "elif_clause", "while_statement"),
	nested: set("argument_list", "subscript", "slice", "list", "tuple", "set", "dictionary", "pair", "list_comprehension", "set_comprehension", "dictionary_comprehension", "generator_expression", "interpolation"),
	transparent: set("assignment", "augmented_assignment"),
	loops: none,
};

const rs: Adapter = {
	id: "rs",
	blocks: set("block", "declaration_list", "field_declaration_list", "match_block", "enum_variant_list"),
	functions: set("function_item"),
	grammar: "tree-sitter-rust/tree-sitter-rust.wasm",
	extensions: [".rs"],
	binary: set("binary_expression"),
	assignment: set("assignment_expression", "compound_assignment_expr", "let_declaration"),
	conditional: set(),
	grouping: set("parenthesized_expression"),
	structural: set("if_expression", "while_expression", "match_expression"),
	// Macro arguments (println!, vec!) are raw token trees, so they are never touched.
	nested: set("arguments", "index_expression", "array_expression", "tuple_expression", "range_expression", "field_initializer"),
	transparent: set("assignment_expression", "compound_assignment_expr", "let_declaration"),
	loops: none,
};

export const languages: Record<string, Adapter> = { php, c, cpp, js, ts, tsx, cs, java, py, rs };

export function languageForPath(path: string): Adapter | undefined {
	const lower = path.toLowerCase();
	return Object.values(languages).find(lang => lang.extensions.some(ext => lower.endsWith(ext)));
}
