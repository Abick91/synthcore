// Contrato de la API pública `synthesize()`. Estos tests FIJAN el comportamiento observable (no la receta exacta,
// que el motor puede cambiar entre versiones) para que ningún refactor del núcleo lo rompa en silencio. Corre con
// `npm test`. Sin red, sin LLM: cada caso es determinista y verificado por el propio motor.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  synthesize,
  grade,
  buildOps,
  solveBySynthesis,
  learnAbstractions,
  valType,
  inferSig,
  type Example,
} from "./index.js";

/** Carga el `code` emitido (defs de ops + `function <entry>(){}`) y devuelve la función para ejercitarla en proceso.
 *  Es lo que demuestra la promesa "verificado": no confiamos en la receta, ejecutamos el código y comprobamos salidas. */
function loadSolve(code: string, entry = "solve"): (...args: unknown[]) => unknown {
  return new Function(`${code}; return ${entry};`)() as (...args: unknown[]) => unknown;
}

// Tareas pequeñas y robustas (se resuelven en la fase de aplicación directa → tests rápidos en CI).
const DOUBLE: Example[] = [{ input: 2, output: 4 }, { input: 3, output: 6 }, { input: 5, output: 10 }];
const UPPER: Example[] = [{ input: "ab", output: "AB" }, { input: "hi", output: "HI" }, { input: "xy", output: "XY" }];

test("resuelve una tarea simple y devuelve una función VERIFICADA que ejecuta de verdad", async () => {
  const r = await synthesize(DOUBLE);
  assert.equal(r.ok, true);
  if (!r.ok) return; // narrow
  // Forma del resultado (el contrato exacto que consumen los usuarios).
  assert.equal(typeof r.code, "string");
  assert.equal(typeof r.recipe, "string");
  assert.ok(r.recipe.length > 0);
  assert.equal(typeof r.size, "number");
  assert.ok(r.size >= 1);
  assert.equal(r.entry, "solve");
  assert.match(r.code, /function solve\b/);
  assert.ok(r.ast && typeof r.ast === "object" && "k" in r.ast); // el AST de la receta (lo consume learn())
  // El código emitido pasa los ejemplos Y generaliza a un held-out (no solo memoriza los 3 dados).
  const solve = loadSolve(r.code);
  for (const e of DOUBLE) assert.equal(solve((e as any).input), (e as any).output);
  assert.equal(solve(7), 14);
});

test("las primitivas estándar (std) son opt-in: una fecha solo se resuelve con { std: true }", async () => {
  const dates: Example[] = [{ input: "2024-03-15", output: 2024 }, { input: "1999-12-31", output: 1999 }, { input: "2010-01-01", output: 2010 }];
  const without = await synthesize(dates, { maxEvals: 200_000 });
  assert.equal(without.ok, false, "sin std no debería existir una primitiva de fecha"); // opt-in: no infla la búsqueda por defecto
  const withStd = await synthesize(dates, { std: true });
  assert.equal(withStd.ok, true);
  if (withStd.ok) assert.equal(loadSolve(withStd.code)("2030-06-01"), 2030); // generaliza (UTC, sin depender de la zona horaria)
});

test("acepta las tres formas de ejemplo: {input,output}, {in,out}, {args,expect}", async () => {
  const shapes: Example[][] = [
    [{ input: 2, output: 4 }, { input: 3, output: 6 }, { input: 5, output: 10 }],
    [{ in: 2, out: 4 }, { in: 3, out: 6 }, { in: 5, out: 10 }],
    [{ args: [2], expect: 4 }, { args: [3], expect: 6 }, { args: [5], expect: 10 }],
  ];
  for (const examples of shapes) {
    const r = await synthesize(examples);
    assert.equal(r.ok, true, `forma no aceptada: ${JSON.stringify(examples[0])}`);
    if (r.ok) assert.equal(loadSolve(r.code)(6), 12);
  }
});

test("un `input` array es UN argumento-lista, no varargs (contrato de aridad)", async () => {
  // Decisión de API deliberada: `{ input: [1,2,3] }` significa f([1,2,3]), no f(1,2,3). Esto fija esa semántica
  // para que un refactor no vuelva a esparcir la lista en posicionales (footgun que rompía la reducción de listas).
  const SUM: Example[] = [{ input: [1, 2, 3], output: 6 }, { input: [10, 20], output: 30 }, { input: [5], output: 5 }];
  const r = await synthesize(SUM);
  assert.equal(r.ok, true, "suma de lista debería resolverse con input=array como un solo argumento");
  if (!r.ok) return;
  const solve = loadSolve(r.code);
  assert.equal(solve([1, 2, 3]), 6);     // se llama con UN array, no con 3 números
  assert.equal(solve([4, 5, 6, 7]), 22); // generaliza a una lista de otra longitud
});

test("respeta el nombre de la función (entry) pedido", async () => {
  const r = await synthesize(UPPER, { entry: "transform" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.entry, "transform");
  assert.match(r.code, /function transform\b/);
  assert.equal(loadSolve(r.code, "transform")("zz"), "ZZ");
});

test("entradas vacías o malformadas → {ok:false, reason:'bad_input'} (sin sintetizar)", async () => {
  const empty = await synthesize([]);
  assert.deepEqual(empty, { ok: false, reason: "bad_input" });

  const garbage = await synthesize([{ foo: 1 } as unknown as Example]);
  assert.deepEqual(garbage, { ok: false, reason: "bad_input" });

  const noArgs = await synthesize([{ args: [], expect: 5 } as Example]);
  assert.deepEqual(noArgs, { ok: false, reason: "bad_input" });
});

test("mapeo no sintetizable dentro del presupuesto → {ok:false, reason:'not_found'}", async () => {
  // número → string arbitrario sin relación derivable del input: el motor no debe alucinar una solución.
  const impossible: Example[] = [
    { input: 1, output: "cat" },
    { input: 2, output: "dog" },
    { input: 3, output: "fish" },
  ];
  const r = await synthesize(impossible, { maxEvals: 50_000 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_found");
});

test("verify:false sigue devolviendo código correcto para una tarea resoluble", async () => {
  const r = await synthesize(DOUBLE, { verify: false });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(loadSolve(r.code)(9), 18);
});

test("el código devuelto es honesto: el verificador público `grade` lo aprueba", async () => {
  const r = await synthesize(UPPER);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const v = await grade(r.code, {
    id: "t", kind: "api", held_out: true, prompt: "", entry: r.entry,
    cases: UPPER.map((e) => ({ args: [(e as any).input], expect: (e as any).output })),
  });
  assert.equal(v.passed, true);
  assert.equal(v.ok, v.total);
});

test("la superficie avanzada de la API está exportada y es usable", () => {
  assert.equal(typeof solveBySynthesis, "function");
  assert.equal(typeof learnAbstractions, "function");
  assert.equal(typeof grade, "function");
  assert.equal(typeof buildOps, "function");
  // utilidades de tipos/firma
  assert.equal(valType([1, 2, 3]), "array");
  assert.equal(valType("x"), "string");
  const sig = inferSig([{ args: [2], expect: 4 }]);
  assert.deepEqual(sig, { inputs: ["number"], output: "number" });
  // buildOps sin tools devuelve el DSL base (lista no vacía de ops con nombre+aridad).
  const ops = buildOps([]);
  assert.ok(Array.isArray(ops) && ops.length > 0);
  assert.ok(ops.every((o) => typeof o.name === "string" && typeof o.arity === "number"));
});
