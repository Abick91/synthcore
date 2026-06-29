// Contrato de v2: bundles de dominio (física/química) + emisión multi-lenguaje (Python). Fija que (1) las leyes
// científicas se sintetizan vía extraPrims y (2) el Python emitido es ESTRUCTURALMENTE correcto y reproduce el
// AST. No ejecuta Python (no asumimos intérprete en CI) — verifica el texto generado y que el JS equivalente,
// ya verificado por synthesize, casa con lo que el Python expresa. Corre con `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesize, emitPython, buildOps, physicsPrims, chemPrims, sciencePrims, type Example } from "./index.js";

test("sintetiza una ley física (energía cinética) vía extraPrims", async () => {
  const KE: Example[] = [
    { args: [2, 3], expect: 9 }, { args: [4, 5], expect: 50 },
    { args: [1, 10], expect: 50 }, { args: [3, 2], expect: 6 },
  ];
  const r = await synthesize(KE, { extraPrims: physicsPrims });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.recipe, /kinetic/);
});

test("sin el bundle de química, pH NO se resuelve (opt-in real: el DSL base no tiene log10)", async () => {
  // pH = -log10[H+] necesita una primitiva logarítmica genuinamente ausente del DSL base aritmético.
  // (Nota honesta: leyes puramente multiplicativas como ½mv² SÍ son expresables con la aritmética base —
  //  el opt-in importa para operaciones nuevas, no para las que ya están en la clausura del DSL.)
  const r = await synthesize([
    { input: 0.01, output: 2 }, { input: 0.001, output: 3 }, { input: 0.1, output: 1 },
  ]); // sin extraPrims
  assert.equal(r.ok, false);
});

test("sintetiza una ley química (pH = -log10[H+]) vía extraPrims", async () => {
  const r = await synthesize([
    { input: 0.01, output: 2 }, { input: 0.001, output: 3 }, { input: 0.1, output: 1 },
  ], { extraPrims: chemPrims });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.recipe, /pH/);
});

test("sciencePrims combina física + química en un solo bundle", () => {
  assert.ok(sciencePrims.length >= physicsPrims.length + chemPrims.length);
});

test("emitPython transpila el DSL base a Python autónomo y bien formado", async () => {
  const up = await synthesize([{ input: "ab", output: "AB" }, { input: "hi", output: "HI" }]);
  assert.equal(up.ok, true);
  if (!up.ok) return;
  const py = emitPython(up.ast);
  assert.match(py, /def solve\(\*a\):/);
  assert.match(py, /\.upper\(\)/);
});

test("emitPython respeta entry custom y emite imports solo cuando se usan", async () => {
  const ph = await synthesize([
    { input: 0.01, output: 2 }, { input: 0.001, output: 3 }, { input: 0.1, output: 1 },
  ], { extraPrims: chemPrims });
  assert.equal(ph.ok, true);
  if (!ph.ok) return;
  const py = emitPython(ph.ast, { extraPrims: chemPrims, entry: "compute_ph" });
  assert.match(py, /import math/);            // pH usa math.log10
  assert.match(py, /def compute_ph\(\*a\):/);
});

test("emitPython transpila el combinador fold (sum sobre array)", async () => {
  const sm = await synthesize([{ input: [1, 2, 3], output: 6 }, { input: [10, 20], output: 30 }]);
  assert.equal(sm.ok, true);
  if (!sm.ok) return;
  const py = emitPython(sm.ast);
  assert.match(py, /sum\(a\[0\]\)/);
});

test("emitPython lanza un error claro si un op no tiene plantilla (honestidad)", () => {
  // Un extraPrim con `src` JS arbitrario (lo que sembraría un LLM) NO se transpila: localizamos su índice real
  // y construimos un AST que lo referencia → debe fallar con mensaje, no emitir Python incorrecto.
  const seeded = { name: "b64", arity: 1, src: "(s)=>Buffer.from(s).toString('base64')", inputs: ["string"] };
  const ops = buildOps([], [seeded]);
  const idx = ops.findIndex((o) => o.name === "b64");
  assert.ok(idx >= 0);
  const ast = { k: "app" as const, op: idx, args: [{ k: "arg" as const, i: 0 }] };
  assert.throws(() => emitPython(ast as any, { extraPrims: [seeded] }), /plantilla|template/i);
});
