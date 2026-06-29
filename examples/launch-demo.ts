// LAUNCH DEMO — guion reproducible para grabar el GIF de lanzamiento. Cada paso ejecuta síntesis REAL (no está
// fingido): ejemplos entran, función verificada sale. El ritmo (sleeps) está pensado para un clip de ~12-15 s.
// Grábalo con:  npx tsx examples/launch-demo.ts   (ver el guion de grabación en la respuesta del lanzamiento)
import { synthesize, emitPython, chemPrims, type Example } from "../src/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const C = {
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

async function beat(title: string, examples: Example[], opts: Parameters<typeof synthesize>[1] = {}, py = false) {
  console.log(C.dim("\n  " + title));
  for (const e of examples) console.log("  " + C.cyan(JSON.stringify(e)));
  process.stdout.write(C.dim("\n  synthesizing… "));
  await sleep(650);
  const r = await synthesize(examples, opts);
  if (r.ok) {
    console.log(C.green("✓ verified, $0"));
    console.log("  → " + C.bold(C.green(r.recipe)));
    if (py) { console.log(C.dim("  python:")); for (const ln of emitPython(r.ast, opts as any).trimEnd().split("\n")) console.log("    " + C.green(ln)); }
  } else {
    console.log(C.yellow("✗ " + r.reason) + C.dim("  — it said no. it never hallucinates."));
  }
  await sleep(1100);
}

(async () => {
  console.clear();
  console.log(C.bold("\n  synthcore") + C.dim("  ·  examples in, verified code out  ·  no LLM, no GPU"));
  await sleep(900);

  // Beat 1 — limpieza de datos (data wrangling real): precio sucio → número.
  await beat("clean a messy price  ($ → number)", [
    { input: "$1,234.50", output: 1234.5 },
    { input: "$10.00", output: 10 },
    { input: "$3,000", output: 3000 },
  ], { std: true });

  // Beat 2 — el "whoa": recupera una LEY EXACTA desde datos (necesita el bundle de química).
  await beat("recover an exact law  (pH from [H+])", [
    { input: 0.01, output: 2 },
    { input: 0.001, output: 3 },
    { input: 0.0001, output: 4 },
  ], { extraPrims: chemPrims }, true);

  // Beat 3 — honestidad: lo imposible devuelve not_found, no una mentira plausible.
  await beat("no derivable rule?", [
    { input: 1, output: "cat" },
    { input: 2, output: "dog" },
    { input: 3, output: "fish" },
  ]);

  console.log(C.dim("\n  ────────────────────────────────"));
  console.log("  " + C.bold("Verified, not vibes."));
  console.log(C.dim("  No LLM. No GPU. $0. Offline. MIT."));
  console.log(C.cyan("  github.com/Abick91/synthcore") + "\n");
})();
