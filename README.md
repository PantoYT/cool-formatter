# Cool Formatter™

<img src="art/icon.png" width="96" alt="Three interlinked Möbius strips forming a triangle, in pixel art">

Operator spacing that follows precedence, so code reads the way it binds.
Spaces go around the operator that binds loosest and disappear where operands
belong together:

```php
// before (Prettier, PSR-12, clang-format)        // after Cool Formatter
$obw = 2 * $a + 2 * $b;                           $obw = 2*$a + 2*$b;
$p = ($a + $b) * ($a - $b);                       $p = ($a+$b)*($a-$b);
if ($x > 0 && $y < 10) {                          if ($x>0 && $y<10) {
if ($a + $b > 10) {                               if ($a+$b > 10) {
for ($i = 0; $i < $n; $i++) {                     for ($i=0; $i<$n; $i++) {
echo "Area: " . $area . " cm2";                   echo "Area: ".$area." cm2";
```

It works on PHP (including PHP inside HTML), C, C++, JavaScript and
TypeScript (with JSX/TSX), C#, Java, Python and Rust, as a VS Code extension
and as a command-line tool. It changes whitespace only: around operators, the
column of `=>` in multi-line PHP arrays and the blank line between functions.
Braces, indentation and line wrapping stay the job of your usual formatter,
which the extension runs first.

## Why another tool

Formatters that let you configure operator spacing (PHP-CS-Fixer, Uncrustify)
do it per operator, so the best they can produce is `($a + $b)*($a - $b)`.
yapf has a precedence mode for Python, and gofmt does this for Go, but nothing
did it for the C family. Cool Formatter decides from the syntax tree, where
precedence is already encoded, so it knows the difference between a lone
`$a + $b` and the same sum under a comparison, inside parentheses or inside a
for-loop header.

## Rules of the default preset (`panto`)

| Operators | Spacing |
|---|---|
| `*` `/` `%` `**`, PHP `.`, Python `//` `@` | always tight: `$sum/$n`, `"a".$b` |
| `==` `!=` `===` `!==` `<=>` `&&` `\|\|` `??` `and` `or` | always spaced, except `==`-like inside a for header |
| `+` `-` and `<` `>` `<=` `>=` | spaced only when they are the loosest operator of a statement-level expression; tight under a looser operator, in grouping parentheses, call arguments, subscripts, array literals, a ternary or a for header |
| `=` | spaced, tight inside a for header |
| `+=` `-=` `.=` ... | tight: `$n+=1` |
| `? :` | spaced, `?:` stays whole |
| `=>` | tight in a one-line array; in a multi-line one, lined up in a column one space past the longest key |
| functions | exactly one blank line between neighbouring definitions (not when a comment sits between them) |

The `classic` preset puts a space around every operator, as Prettier does, and
leaves arrays and blank lines alone. Bit operators, shifts, `instanceof`, `in`,
`is` and Rust ranges are always left as written, and so are Rust macro
arguments such as `println!(...)`, which the grammar sees as raw tokens.

## VS Code

Install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=panto.cool-formatter)
(search for Cool Formatter in the Extensions view, or
`code --install-extension panto.cool-formatter`). VSCodium, Cursor and other
editors that use Open VSX can install it from there, and every
[GitHub release](https://github.com/PantoYT/cool-formatter/releases) has the
`.vsix` attached.

Then make it the formatter of the languages you want:

```json
"[php]": { "editor.defaultFormatter": "panto.cool-formatter" },
"[cpp]": { "editor.defaultFormatter": "panto.cool-formatter" },
"[javascript]": { "editor.defaultFormatter": "panto.cool-formatter" }
```

Language ids: `php`, `c`, `cpp`, `javascript`, `javascriptreact`, `typescript`,
`typescriptreact`, `csharp`, `java`, `python`, `rust`.

When it formats a document, it lays the document out first and then fixes the
operators, so one Format Document or format-on-save does both:

- JavaScript and TypeScript go through VS Code's own formatting engine (the
  TypeScript language service, bundled), configured by your
  `javascript.format.*` / `typescript.format.*` settings. It never rewrites
  quotes, and it does not depend on which other formatter is installed;
  Prettier would turn `'a'` into `"a"`.
- Every other language goes through the formatter extension VS Code offers for
  it: Intelephense, C/C++, C#, Ruff, rust-analyzer and so on.

| Setting | Default | |
|---|---|---|
| `coolFormatter.preset` | `panto` | `panto` or `classic` |
| `coolFormatter.baseFormatter` | `auto` | `auto` as above, `extension` always asks the other extension (Prettier for JS too), `none` only fixes spacing |

Skipped files (see Safety) are reported in the Cool Formatter output channel.

## Command line

Requires Node.js 22.18 or newer (it runs the TypeScript sources directly).

```sh
node src/cli.ts file.php              # print the formatted file
node src/cli.ts --write src/*.cpp     # rewrite in place
node src/cli.ts --check src/*.php     # list files that would change, exit 1 if any
node src/cli.ts --stdin --path x.php  # stdin to stdout, for editor integration
node src/cli.ts tree file.cpp         # print the syntax tree
node src/cli.ts selftest              # run the built-in cases
```

## Configuration file

A `.cool-formatter.json` in the file's folder or any parent picks the preset
and overrides single options, for the extension and the command line alike:

```json
{ "preset": "panto", "ternary": "keep", "arrowSingleLine": "spaced" }
```

Every option of `src/style.ts` can be set; spacing values are `tight`,
`spaced` or `keep`, plus `align` for `arrowMultiLine`, and `functionGap` is
`one` or `keep`.

## Safety

- Only whitespace is rewritten: around an operator never across a line break
  or next to a comment, between functions only when nothing but whitespace
  separates them, keeping the file's line endings.
- A space is never removed where two characters would fuse into a longer
  token, the way real compilers read them: `a - -b` does not become `a--b`,
  `$x . 5` does not become `$x .5`, `a / *p` does not become a comment.
- The result is parsed again and must give exactly the same tokens, otherwise
  the file is returned unchanged.

It was run over about 500 real files from school, olympiad and personal
projects, and each changed file was checked with the language's own tools:
PHP's `token_get_all` (82 files), identical `g++ -S` assembly (65), the
TypeScript parser's tokens for JS (32), Python's `tokenize` (100) and
identical `javac` bytecode for the Java files that compile on their own (7).
None differed. Rust and C# rely on the checks above.

## Development

```sh
npm test               # selftest, 71 cases
npm run typecheck
npm run test:vscode    # extension tests in a throwaway VS Code instance
```

`test:vscode` starts VS Code with its own profile under `.vscode-test/`, so
your settings are untouched. If Intelephense and the C/C++ extension are
installed, they are loaded from your extensions folder to test the
base-formatter chain. `VSCODE_BIN` and `VSCODE_EXTENSIONS` override where VS
Code and the extensions are looked up.

To release, set the version in `package.json`, commit, and push a tag with
the same number:

```sh
git tag v0.3.1
git push origin v0.3.1
```

`.github/workflows/publish.yml` then tests and packages it and publishes it
to the VS Code Marketplace (trusted publishing, no stored token), Open VSX
(the `OVSX_PAT` secret) and GitHub Releases. Started by hand from the Actions
tab, it only builds the package.

The icon started as a render and was finished by hand. `scripts/icon.js`
traces three Möbius strips in 3D into a small z-buffer and quantizes them to a
fixed palette; the 32x32 result was then edited pixel by pixel.
`art/icon-32.png` is that original, `art/icon.png` the same scaled 4x with
nearest-neighbour, so every pixel stays a sharp 4x4 square.

Parsing is done by [tree-sitter](https://tree-sitter.github.io/) grammars
compiled to WebAssembly, so nothing native is installed. A new language needs
an adapter in `src/languages.ts` that names its node types (`tree` shows
them) and selftest cases. Go is left out on purpose: gofmt already spaces
by precedence and Go code is expected to be gofmt'ed.

## License

Copyright (C) 2026 Panto (PantoYT)

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [LICENSE](LICENSE).
