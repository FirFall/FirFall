/* Parses the inline <script> out of the Android shell and syntax-checks it with
 * node. A single mangled string literal makes the whole script block fail to
 * parse, which shows up in the app as "nothing happens at all" with no error
 * anywhere, so this runs after every edit pass. */
import { readFileSync } from "node:fs";

const src = process.argv[2];
const html = readFileSync(src, "utf8");

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (!blocks.length) {
  console.log("no inline <script> block found in " + src);
  process.exit(1);
}
let bad = 0;
blocks.forEach((m, i) => {
  const code = m[1];
  const line = html.slice(0, m.index).split("\n").length;
  try {
    // new Function parses without executing: enough for a syntax gate.
    new Function(code);
    console.log(`  block ${i + 1} @ line ${line}: OK (${code.length} chars)`);
  } catch (e) {
    bad++;
    console.log(`  block ${i + 1} @ line ${line}: SYNTAX ERROR -> ${e.message}`);
    // Point at the offending line inside the block so the message is usable.
    const guess = /(\d+):(\d+)/.exec(e.stack || "");
    if (guess) {
      const ln = Number(guess[2]);
      code.split("\n").slice(Math.max(0, ln - 3), ln + 2)
        .forEach((l, k) => console.log(`      ${Math.max(1, ln - 2) + k}| ${l}`));
    }
  }
});

// Cheap structural checks that a parse will not catch.
// Only the static markup is scanned: ids inside <script> are template strings
// that get written into a container one sheet at a time, so a repeated id
// there (sheetTitle, sheetSub) is expected and not a collision.
const staticHtml = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "");
const ids = new Set();
for (const m of staticHtml.matchAll(/\sid="([^"]+)"/g)) {
  if (ids.has(m[1])) console.log(`  DUPLICATE id="${m[1]}"`);
  ids.add(m[1]);
}
const refs = new Set([...html.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
const missing = [...refs].filter((r) => !ids.has(r));
if (missing.length) console.log(`  $() references with no static id: ${missing.join(", ")}`);

console.log(bad ? `FAILED: ${bad} block(s) with syntax errors` : "parse OK");
process.exit(bad || missing.length ? 1 : 0);
