# opspace

Precedence-aware operator spacing for PHP, C and C++. Spaces show which
operator binds loosest, so the shape of an expression is visible at a glance:

```php
// before (Prettier, PSR-12, clang-format)        // after opspace
$obw = 2 * $a + 2 * $b;                           $obw = 2*$a + 2*$b;
$p = ($a + $b) * ($a - $b);                       $p = ($a+$b)*($a-$b);
if ($x > 0 && $y < 10) {                          if ($x>0 && $y<10) {
if ($a + $b > 10) {                               if ($a+$b > 10) {
for ($i = 0; $i < $n; $i++) {                     for ($i=0; $i<$n; $i++) {
echo "Area: " . $area . " cm2";                   echo "Area: ".$area." cm2";
```

opspace only touches the whitespace next to operators. Braces, indentation and
line wrapping stay the job of your usual formatter; run opspace after it.

## Why another tool

Formatters that let you configure operator spacing (PHP-CS-Fixer, Uncrustify)
do it per operator, so the best they can produce is `($a + $b)*($a - $b)`.
yapf has a precedence mode for Python, and gofmt does this for Go, but nothing
did it for the C family. opspace decides from the syntax tree, where
precedence is already encoded, so it knows the difference between a lone
`$a + $b` and the same sum under a comparison, inside parentheses or inside a
for-loop header.

## Rules of the default preset (`panto`)

| Operators | Spacing |
|---|---|
| `*` `/` `%` `**`, PHP `.` | always tight: `$sum/$n`, `"a".$b` |
| `==` `!=` `===` `!==` `<=>` `&&` `\|\|` `??` `and` `or` | always spaced, except `==`-like inside a for header |
| `+` `-` and `<` `>` `<=` `>=` | spaced only when they are the loosest operator of a statement-level expression; tight under a looser operator, in grouping parentheses, call arguments, subscripts, array literals, a ternary or a for header |
| `=` | spaced, tight inside a for header |
| `+=` `-=` `.=` ... | tight: `$n+=1` |
| `? :` | spaced, `?:` stays whole |
| `=>` | tight in a one-line array, untouched in a multi-line (aligned) one |

The `classic` preset puts a space around every operator, as Prettier does.
Bit operators, shifts and `instanceof` are always left as written.

## Safety

- Only the whitespace directly around an operator is rewritten, never a line
  break and never next to a comment.
- A space is never removed where two characters would fuse into a longer
  token, the way real compilers read them: `a - -b` does not become `a--b`,
  `$x . 5` does not become `$x .5`, `a / *p` does not become a comment.
- The result is parsed again and must give exactly the same tokens, otherwise
  the file is returned unchanged.

It was run over about 280 real PHP and C++ files from school and olympiad
work: every changed PHP file gave the same token stream from PHP's own
`token_get_all`, and every changed C++ file compiled to identical assembly.

## Usage

Requires Node.js 22.18 or newer (it runs the TypeScript sources directly).

```sh
npm install
node src/cli.ts file.php              # print the formatted file
node src/cli.ts --write src/*.cpp     # rewrite in place
node src/cli.ts --check src/*.php     # list files that would change, exit 1 if any
node src/cli.ts --stdin --path x.php  # stdin to stdout, for editor integration
node src/cli.ts tree file.cpp         # print the syntax tree
node src/cli.ts selftest              # run the built-in cases
```

A `.opspace.json` in the file's folder or any parent picks the preset and
overrides single options:

```json
{ "preset": "panto", "ternary": "keep", "arrowSingleLine": "spaced" }
```

Every option of `src/style.ts` can be set; spacing values are `tight`,
`spaced` or `keep`.

## Languages

PHP (including PHP inside HTML), C and C++. Parsing is done by
[tree-sitter](https://tree-sitter.github.io/) grammars compiled to WebAssembly,
so nothing native is installed. A new language needs an adapter in
`src/languages.ts` that names its node types (`opspace tree` shows them) and
selftest cases. Planned: JavaScript and TypeScript, C#, Java, Python, Rust,
and a VS Code extension.
