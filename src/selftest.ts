// Built-in cases: each input must format to the expected text, and the
// expected text must already be stable (formatting it again changes nothing).

import { format, tokenizesSame } from "./core.ts";
import { languages } from "./languages.ts";
import { presets } from "./style.ts";

interface Case {
	name: string;
	lang: string;
	input: string;
	expected: string;
	preset?: string;
}

const php = (body: string) => "<?php\n" + body + "\n";

const cases: Case[] = [
	{
		name: "the example that started it",
		lang: "php",
		input: php(`function obw_prostokata(int $a, int $b)
{
	$obw = 2 * $a + 2 * $b;
	return $obw;
}
function srednia(array $zmienne)
{
	$n = 0;
	$suma = 0;
	foreach ($zmienne as $zmienna) {
		$n += 1;
		$suma += $zmienna;
	}
	$avg = $suma / $n;
	return $avg;
}`),
		expected: php(`function obw_prostokata(int $a, int $b)
{
	$obw = 2*$a + 2*$b;
	return $obw;
}
function srednia(array $zmienne)
{
	$n = 0;
	$suma = 0;
	foreach ($zmienne as $zmienna) {
		$n+=1;
		$suma+=$zmienna;
	}
	$avg = $suma/$n;
	return $avg;
}`),
	},
	{ name: "quiz 3: arithmetic", lang: "php", input: php("$delta = $b * $b - 4 * $a * $c;"), expected: php("$delta = $b*$b - 4*$a*$c;") },
	{ name: "quiz 4: parentheses", lang: "php", input: php("$p = ($a + $b) * ($a - $b);"), expected: php("$p = ($a+$b)*($a-$b);") },
	{ name: "quiz 5: assignments", lang: "php", input: php("$n = 0;\n$n += 1;\n$s .= \"x\";"), expected: php("$n = 0;\n$n+=1;\n$s.=\"x\";") },
	{ name: "quiz 6: comparisons under &&", lang: "php", input: php("if ($x > 0 && $y < 10) {}"), expected: php("if ($x>0 && $y<10) {}") },
	{ name: "quiz 7: concatenation", lang: "php", input: php("echo \"Pole: \" . $pole . \" cm2<br>\";"), expected: php("echo \"Pole: \".$pole.\" cm2<br>\";") },
	{ name: "quiz 8: for header", lang: "php", input: php("for ($i = 0; $i < $n; $i++) {}"), expected: php("for ($i=0; $i<$n; $i++) {}") },
	{ name: "extra 1: lone plus", lang: "php", input: php("$suma = $a+$b;"), expected: php("$suma = $a + $b;") },
	{ name: "extra 2: plus under a comparison", lang: "php", input: php("if ($a + $b > 10) {}"), expected: php("if ($a+$b > 10) {}") },
	{ name: "extra 3: equality is spaced", lang: "php", input: php("if ($n==0||$s!==\"\") {}"), expected: php("if ($n == 0 || $s !== \"\") {}") },
	{ name: "extra 4: call arguments", lang: "php", input: php("pole($a + 1, $b - 1);"), expected: php("pole($a+1, $b-1);") },
	{ name: "extra 5: ternary", lang: "php", input: php("$m = ($a > $b)?$a:$b;"), expected: php("$m = ($a>$b) ? $a : $b;") },
	{ name: "extra 6: one-line array", lang: "php", input: php("$u = ['nr' => 7, 'klasa' => '2T'];"), expected: php("$u = ['nr'=>7, 'klasa'=>'2T'];") },
	{
		name: "multi-line array keeps its alignment",
		lang: "php",
		input: php("$u = [\n\t'nr'    => 7,\n\t'klasa' => '2T',\n];"),
		expected: php("$u = [\n\t'nr'    => 7,\n\t'klasa' => '2T',\n];"),
	},
	{ name: "subscripts and array items", lang: "php", input: php("$t[$i - 1] = [$a + 1, $b];"), expected: php("$t[$i-1] = [$a+1, $b];") },
	{ name: "null coalescing", lang: "php", input: php("$x = $a??$b;"), expected: php("$x = $a ?? $b;") },
	{ name: "short ternary stays whole", lang: "php", input: php("$x = $a ?: $b;"), expected: php("$x = $a ?: $b;") },
	{ name: "a - -b never fuses", lang: "php", input: php("f($b - -$c);"), expected: php("f($b - -$c);") },
	{ name: "concatenating a number never becomes a float", lang: "php", input: php("$x = $y . 5;\n$z = 1 . $y;"), expected: php("$x = $y . 5;\n$z = 1 . $y;") },
	{ name: "i++ + 1 never fuses", lang: "php", input: php("f($i++ + 1);"), expected: php("f($i++ + 1);") },
	{ name: "a + ++b never fuses", lang: "php", input: php("f($a + ++$b);"), expected: php("f($a + ++$b);") },
	{ name: "comment next to an operator", lang: "php", input: php("$x = $a + /* why */ $b;"), expected: php("$x = $a + /* why */ $b;") },
	{ name: "line breaks stay", lang: "php", input: php("$x = $a\n\t. $b;"), expected: php("$x = $a\n\t.$b;") },
	{ name: "Polish and emoji before code", lang: "php", input: php("// średnia 😀\n$avg = $suma / $n;"), expected: php("// średnia 😀\n$avg = $suma/$n;") },
	{ name: "PHP inside HTML", lang: "php", input: "<p><?= $a * 2 + 1 ?></p>\n<?php if ($x > 0): ?>ok<?php endif; ?>\n", expected: "<p><?= $a*2 + 1 ?></p>\n<?php if ($x > 0): ?>ok<?php endif; ?>\n" },
	{ name: "classic preset spaces everything", lang: "php", preset: "classic", input: php("$p = ($a+$b)*($a-$b);\n$n+=1;"), expected: php("$p = ($a + $b) * ($a - $b);\n$n += 1;") },

	{ name: "C++ for header", lang: "cpp", input: "for (int i = 0; i < n; i++) {}\n", expected: "for (int i=0; i<n; i++) {}\n" },
	{ name: "C++ != in a for header", lang: "cpp", input: "for (int i = 1; i != n && ok; i++) {}\n", expected: "for (int i=1; i!=n && ok; i++) {}\n" },
	{ name: "PHP keeps . spaced next to a digit", lang: "php", input: php("echo \"Wynik: \" . 2 + 3;"), expected: php("echo \"Wynik: \" . 2+3;") },
	{ name: "C++ two counters", lang: "cpp", input: "for (int i = 0, j = n - 1; i < j; i++, j--) {}\n", expected: "for (int i=0, j=n-1; i<j; i++, j--) {}\n" },
	{ name: "C++ arithmetic", lang: "cpp", input: "void f() { x = a * b - c; y = (a + b) * (a - b); }\n", expected: "void f() { x = a*b - c; y = (a+b)*(a-b); }\n" },
	{ name: "C++ if and while", lang: "cpp", input: "void f() { if (a + b > 10) return; while (i < n) i++; }\n", expected: "void f() { if (a+b > 10) return; while (i < n) i++; }\n" },
	{ name: "C++ stream output", lang: "cpp", input: "void f() { cout << a + b << endl; }\n", expected: "void f() { cout << a+b << endl; }\n" },
	{ name: "C++ templates and pointers untouched", lang: "cpp", input: "vector<vector<int>> v(n + 1);\nint* p = &x;\n", expected: "vector<vector<int>> v(n+1);\nint* p = &x;\n" },
	{ name: "C++ compound and unary", lang: "cpp", input: "void f() { y += -a; arr[i - 1] = 2; }\n", expected: "void f() { y+=-a; arr[i-1] = 2; }\n" },
	{ name: "C++ ternary", lang: "cpp", input: "int f() { return a > b ? a : b; }\n", expected: "int f() { return a>b ? a : b; }\n" },
	{ name: "C++ modulo chain", lang: "cpp", input: "long long s = 1LL * a * b % MOD;\n", expected: "long long s = 1LL*a*b%MOD;\n" },
	{ name: "C++ logic", lang: "cpp", input: "bool b = x==1&&y!=2;\n", expected: "bool b = x == 1 && y != 2;\n" },
	{ name: "C++ a / *p never becomes a comment", lang: "cpp", input: "void f() { a = b / *p; }\n", expected: "void f() { a = b / *p; }\n" },

	{ name: "C call arguments", lang: "c", input: "void f() { printf(\"%d\\n\", a * 2 + 1); }\n", expected: "void f() { printf(\"%d\\n\", a*2+1); }\n" },
	{ name: "C do-while", lang: "c", input: "void f() { do { i++; } while (i < n); }\n", expected: "void f() { do { i++; } while (i < n); }\n" },
];

// Pairs the re-parse check must tell apart (true = same tokens). tree-sitter's
// lexer is more lenient than real compilers: it reads $y.5 as $y . 5 (PHP
// itself fails with "unexpected floating-point number"), a/*p as a / *p and
// $i+++1 as $i++ + 1. Those are stopped earlier by `fuses` in core.ts, which the
// formatting cases above cover; the re-parse is only the second line.
const guard: [string, string, string, boolean][] = [
	["php", "<?php $a - -$b;", "<?php $a--$b;", false],
	["php", "<?php f($a + ++$b);", "<?php f($a+++$b);", false],
	["cpp", "int f() { return a - >b; }", "int f() { return a->b; }", false],
	["php", "<?php $p = ($a + $b) * 2;", "<?php $p = ($a+$b)*2;", true],
];

export async function selftest(): Promise<boolean> {
	let failed = 0;
	for (const [id, a, b, same] of guard) {
		const got = await tokenizesSame(a, b, languages[id]!);
		if (got === same) {
			console.log(`ok    guard: ${JSON.stringify(b)} ${same ? "accepted" : "rejected"}`);
		} else {
			failed++;
			console.log(`FAIL  guard: ${JSON.stringify(a)} vs ${JSON.stringify(b)} should be ${same ? "same" : "different"}`);
		}
	}
	for (const test of cases) {
		const lang = languages[test.lang]!;
		const style = presets[test.preset ?? "panto"]!;
		const first = await format(test.input, lang, style);
		const again = await format(test.expected, lang, style);
		const problems: string[] = [];
		if (first.text !== test.expected) problems.push(`got:\n${first.text}\nexpected:\n${test.expected}`);
		if (again.text !== test.expected) problems.push(`not stable, formatting the expected text gives:\n${again.text}`);
		if (first.skipped) problems.push(`skipped: ${first.skipped}`);
		if (problems.length) {
			failed++;
			console.log(`FAIL  ${test.name}\n${problems.join("\n")}\n`);
		} else {
			console.log(`ok    ${test.name}`);
		}
	}
	const total = cases.length + guard.length;
	console.log(`\n${total - failed}/${total} passed`);
	return failed === 0;
}
