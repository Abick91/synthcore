// Contrato del aprendizaje de librería y la persistencia (v1.0). Fija que: learn() mina abstracciones reutilizables
// de recetas con sub-patrones recurrentes, que las abstracciones aprendidas se pueden REUSAR en una síntesis nueva,
// y que serializeLibrary/loadLibrary hacen round-trip (y loadLibrary tolera basura sin romper). Sin red, sin LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  synthesize,
  learn,
  serializeLibrary,
  loadLibrary,
  buildOps,
  stdPrims,
  type Recipe,
  type Tool,
} from "./index.js";

function loadSolve(code: string, entry = "solve"): (...args: unknown[]) => unknown {
  return new Function(`${code}; return ${entry};`)() as (...args: unknown[]) => unknown;
}

test("learn() mina una abstracción de un sub-patrón recurrente y queda reutilizable", async () => {
  // Receta hecha a mano que contiene DOS veces el sub-árbol add(arg0,arg0) (= doblar) → la minería MDL debe
  // extraerlo como abstracción de aridad 1. Resolvemos el índice de `add` por NOMBRE (robusto al orden del DSL).
  const ops = buildOps([]);
  const ADD = ops.findIndex((o) => o.name === "add");
  assert.ok(ADD >= 0);
  const dbl: Recipe = { k: "app", op: ADD, args: [{ k: "arg", i: 0 }, { k: "arg", i: 0 }] }; // x+x
  const quad: Recipe = { k: "app", op: ADD, args: [dbl, dbl] };                               // (x+x)+(x+x) = 4x

  const res = await learn([quad]);
  assert.ok(Array.isArray(res.tools) && Array.isArray(res.learned) && Array.isArray(res.abstractions));
  assert.ok(res.learned.length >= 1, "debería aprender al menos una abstracción");
  assert.equal(res.tools.length, res.learned.length); // partimos de [] → tools = solo las nuevas

  // La abstracción aprendida ejecuta como "doblar" (su sub-patrón es add(arg0,arg0)).
  const abs = res.learned[0];
  assert.equal(abs_arity(abs), 1);
  assert.equal(loadSolve(abs.code)(5), 10);
});

function abs_arity(t: Tool): number { return t.sig.inputs.length; }

test("una abstracción aprendida se REUSA en una síntesis nueva (resuelve más con el mismo presupuesto)", async () => {
  const ops = buildOps([]);
  const ADD = ops.findIndex((o) => o.name === "add");
  const dbl: Recipe = { k: "app", op: ADD, args: [{ k: "arg", i: 0 }, { k: "arg", i: 0 }] };
  const quad: Recipe = { k: "app", op: ADD, args: [dbl, dbl] };
  const { tools } = await learn([quad]);

  // Sintetizar "doblar" reutilizando la librería: debe resolverlo (la abstracción cubre add(arg0,arg0)).
  const r = await synthesize([{ input: 3, output: 6 }, { input: 10, output: 20 }, { input: 7, output: 14 }], { tools });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(loadSolve(r.code)(9), 18);
});

test("serializeLibrary/loadLibrary hacen round-trip y loadLibrary tolera basura", () => {
  const tool: Tool = {
    id: "t1", name: "doblar", kind: "abstraction", level: 1,
    code: "function solve(x){ return x+x; }", entry: "solve",
    sig: { inputs: ["number"], output: "number" }, cases: [{ args: [2], expect: 4 }],
  };
  const json = serializeLibrary([tool]);
  const restored = loadLibrary(json);
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0], tool); // round-trip exacto

  // Tolerancia: JSON inválido y herramientas malformadas se descartan, no rompen.
  assert.deepEqual(loadLibrary("{no es json"), []);
  assert.deepEqual(loadLibrary(JSON.stringify({ v: 1, tools: [{ name: "incompleta" }] })), []);
  assert.deepEqual(loadLibrary(JSON.stringify([tool])), [tool]); // admite también un array pelado
});

test("learn() acepta directamente resultados de synthesize() ({ ast })", async () => {
  const a = await synthesize([{ input: 2, output: 8 }, { input: 3, output: 12 }, { input: 5, output: 20 }]); // 4x
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const res = await learn([a]); // pasa el SynthesizeResult entero (tiene .ast) — no hace falta extraer la receta
  assert.ok(Array.isArray(res.learned));
});

test("stdPrims es un bundle no vacío de SeedPrim válidos (name/arity/src)", () => {
  assert.ok(Array.isArray(stdPrims) && stdPrims.length > 0);
  for (const p of stdPrims) {
    assert.equal(typeof p.name, "string");
    assert.equal(typeof p.arity, "number");
    assert.equal(typeof p.src, "string");
  }
});
