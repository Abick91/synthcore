// Krités — examinador DETERMINISTA. Corre el código candidato contra los casos del kata en un
// subproceso Node aislado con timeout. Sin LLM: la única señal de éxito es pasar/fallar los tests.
import { runSandboxed } from "./sandbox.js";

export type Kata = {
  id: string;
  kind: string;
  held_out: boolean;
  prompt: string;
  entry: string; // nombre exacto de la función que el candidato debe definir
  cases: { args: unknown[]; expect: unknown }[];
};

export type Verdict = { passed: boolean; score: number; total: number; ok: number; error?: string };

const TIMEOUT_MS = 5000;

// Ejecuta un módulo Node aislado pasándolo por STDIN (no por `-e`/argv). Con composiciones profundas el código
// + los vectores de test crecen y superaban el límite de tamaño de argv del SO (`spawn E2BIG`, ~128 KB en Linux),
// tumbando el motor. STDIN no tiene ese límite → el grader escala con la profundidad sin romperse.
function runNode(harness: string): Promise<{ out: string; err: string }> {
  // allowCodegen=true: el grader corre código del LLM que podría usar eval/Function legítimamente → no lo bloqueamos
  // aquí (sí en los harness internos del motor). El resto del endurecimiento (sin env, tope memoria, cwd) sigue.
  return runSandboxed(harness, TIMEOUT_MS, true, true);
}

export function stripFences(code: string): string {
  const m = code.match(/```(?:js|javascript|ts)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : code).trim();
}

/**
 * Deriva los casos de un kata generado: ejecuta la solución de REFERENCIA sobre cada tupla de args y
 * captura su salida. Corre DOS veces y exige salidas idénticas → garantiza determinismo (sin random/Date/IO).
 * Devuelve los casos {args, expect} o `null` si la referencia falla, no es determinista o produce undefined.
 * Mantiene el motor "100% real": un kata generado no se usa hasta que se autoverifica.
 */
export function deriveCases(
  reference: string, entry: string, argsList: unknown[][],
): Promise<{ args: unknown[]; expect: unknown }[] | null> {
  const code = stripFences(reference);
  const harness =
    `${code}\n` +
    `const __args = ${JSON.stringify(argsList)};\n` +
    `const __out = __args.map((a) => ${entry}(...a));\n` +
    `if (__out.some((x) => x === undefined)) { console.log("__UNDEF__"); }\n` +
    `else console.log(JSON.stringify(__out));\n`;
  const run = async (): Promise<string | null> => {
    const { out } = await runNode(harness);
    return out.trim().split(/\r?\n/).pop() || null;
  };
  return (async () => {
    const a = await run(); const b = await run();
    if (!a || a === "__UNDEF__" || a !== b) return null; // error, undefined o no determinista
    let parsed: unknown[];
    try { parsed = JSON.parse(a); } catch { return null; }
    if (!Array.isArray(parsed) || parsed.length !== argsList.length) return null;
    return argsList.map((args, i) => ({ args, expect: parsed[i] }));
  })();
}

// ── Verificación property-based: genera inputs aleatorios TIPADOS (mismo shape que los casos del
// profesor) y deriva la salida esperada de la REFERENCIA. Más puntos = menos sobreajuste (una solución
// sintetizada que solo "encaja por casualidad" en 3-6 casos se cae aquí). Reutiliza deriveCases.
type Case = { args: unknown[]; expect: unknown };
const _ri = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** Genera un valor aleatorio con el MISMO shape que `sample` (número/booleano/string/array recursivo). */
function genFromSample(sample: unknown): unknown {
  if (typeof sample === "number") return Number.isInteger(sample) ? _ri(-20, 60) : Math.random() * 100 - 20;
  if (typeof sample === "boolean") return Math.random() < 0.5;
  if (typeof sample === "string") {
    const upper = /[A-Z]/.test(sample), punct = /[^A-Za-z]/.test(sample);
    let cs = "abcdefghijklmnopqrstuvwxyz"; if (upper) cs += cs.toUpperCase(); if (punct) cs += " !,.";
    const len = _ri(0, Math.max(3, (sample.length || 3) + 2));
    let s = ""; for (let i = 0; i < len; i++) s += cs[_ri(0, cs.length - 1)]; return s;
  }
  if (Array.isArray(sample)) {
    const proto = sample.find((x) => x !== undefined);
    const len = _ri(0, Math.max(2, (sample.length || 3) + 1));
    const out: unknown[] = []; for (let i = 0; i < len; i++) out.push(proto !== undefined ? genFromSample(proto) : _ri(-10, 10));
    return out;
  }
  return sample; // objeto u otro tipo → reutiliza el shape de muestra
}
/** Tuplas de argumentos aleatorias, una por fila, con el shape de los casos base. */
function genArgs(baseCases: Case[], n: number): unknown[][] {
  const arity = (baseCases[0]?.args || []).length;
  const sampleAt = (j: number) => { for (const c of baseCases) if (c.args[j] !== undefined) return c.args[j]; return 0; };
  const out: unknown[][] = [];
  for (let i = 0; i < n; i++) out.push(Array.from({ length: arity }, (_, j) => genFromSample(sampleAt(j))));
  return out;
}

/** Enriquece los casos de una kata con vectores aleatorios derivados de la referencia (dedupe por args).
 *  Si la referencia no es determinista/válida sobre los random → devuelve los casos base (no bloquea). */
export async function enrichCases(
  reference: string, entry: string, baseCases: Case[], n = 12,
): Promise<Case[]> {
  if (!reference || !baseCases.length) return baseCases;
  const extra = await deriveCases(reference, entry, genArgs(baseCases, n));
  if (!extra || !extra.length) return baseCases;
  const seen = new Set(baseCases.map((c) => JSON.stringify(c.args)));
  const merged = [...baseCases];
  for (const c of extra) { const k = JSON.stringify(c.args); if (!seen.has(k)) { seen.add(k); merged.push(c); } }
  return merged;
}

export function grade(candidateCode: string, kata: Kata): Promise<Verdict> {
  const code = stripFences(candidateCode);
  const harness =
    `import assert from "node:assert";\n` +
    `${code}\n` +
    `const __cases = ${JSON.stringify(kata.cases)};\n` +
    `let __ok = 0;\n` +
    `for (const c of __cases) {\n` +
    `  try { assert.deepStrictEqual(${kata.entry}(...c.args), c.expect); __ok++; } catch {}\n` +
    `}\n` +
    `console.log(JSON.stringify({ ok: __ok, total: __cases.length }));\n`;

  return (async (): Promise<Verdict> => {
    const total = kata.cases.length;
    const { out, err } = await runNode(harness);
    try {
      const r = JSON.parse(out.trim().split(/\r?\n/).pop() || "{}");
      const ok = Number(r.ok || 0);
      return { passed: ok === total && total > 0, score: total ? ok / total : 0, total, ok };
    } catch {
      return { passed: false, score: 0, total, ok: 0, error: (err || "no output").slice(0, 200) };
    }
  })();
}
