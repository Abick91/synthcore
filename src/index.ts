// synthcore — síntesis inductiva de programas con aprendizaje de librería, para JS/TS. SIN LLM, SIN GPU.
// Dale ejemplos entrada→salida y devuelve una FUNCIÓN VERIFICADA (o null): búsqueda bottom-up tipada con poda por
// equivalencia observacional, sobre un DSL de combinadores; reutiliza una librería de Tools y puede APRENDER
// abstracciones reutilizables (wake/sleep, MDL). Determinista, $0, offline, auditable.
import { solveBySynthesis, type SynthResult, type SeedPrim, type Recipe } from "./synth.js";
import { grade, type Kata } from "./krites.js";
import { setOpScorer } from "./policy.js";
import { stdPrims } from "./prims.js";
import type { Tool } from "./tools.js";

/** Inyecta un sesgo de ranking aprendido (op→peso): el buscador prueba antes las ops más fértiles → resuelve más
 *  profundo con el mismo presupuesto. Sin inyectar, ranking neutro (relevancia de firma + recencia). */
export function configureSearch(opts: { scoreOp?: (name: string) => number }): void {
  if (opts.scoreOp) setOpScorer(opts.scoreOp);
}

// Tres formas de ejemplo. `input`/`in` = UN SOLO argumento (un array es una lista, no varargs) → la forma natural
// `{ input: [1,2,3], output: 6 }` significa f([1,2,3])=6. Para funciones de VARIOS argumentos, la forma explícita
// `{ args: [a, b], expect }` → f(a,b). (Mantener `input`=1-arg evita el footgun de esparcir listas en posicionales.)
export type Example = { args: unknown[]; expect: unknown } | { input: unknown; output: unknown } | { in: unknown; out: unknown };

function toCase(e: any): { args: unknown[]; expect: unknown } | null {
  if (!e || typeof e !== "object") return null;
  if (Array.isArray(e.args) && "expect" in e) return { args: e.args, expect: e.expect };       // multi-arg explícito
  if ("input" in e && "output" in e) return { args: [e.input], expect: e.output };             // input = un argumento
  if ("in" in e && "out" in e) return { args: [e.in], expect: e.out };                         // in = un argumento
  return null;
}

export type SynthesizeResult =
  | { ok: true; code: string; recipe: string; size: number; entry: string; ast: Recipe }
  | { ok: false; reason: "bad_input" | "not_found" | "unverified" };

export type SynthesizeOpts = {
  entry?: string;            // nombre de la función a generar (def "solve")
  tools?: Tool[];            // librería a componer (def [] = solo el DSL base)
  rounds?: number;           // profundidad de composición (def del motor)
  maxEvals?: number;         // tope de evaluaciones (cota del coste)
  extraPrims?: SeedPrim[];   // primitivas EXTRA (p.ej. propuestas por un LLM — ver el patrón "sembrador")
  std?: boolean;             // incluir el bundle `stdPrims` (fechas/regex/números) — opt-in: agranda la búsqueda
  verify?: boolean;          // re-graduar el código antes de devolver (def true = honestidad)
};

/** Sintetiza una función verificada a partir de ejemplos I/O, sin LLM. Devuelve {ok:false} si no la encuentra. */
export async function synthesize(examples: Example[], opts: SynthesizeOpts = {}): Promise<SynthesizeResult> {
  const cases = (Array.isArray(examples) ? examples : []).map(toCase).filter(Boolean) as { args: unknown[]; expect: unknown }[];
  if (cases.length < 1 || !Array.isArray(cases[0].args) || !cases[0].args.length) return { ok: false, reason: "bad_input" };
  const entry = (String(opts.entry || "solve").match(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/) || ["solve"])[0];
  const kata: Kata = { id: "synthcore", kind: "api", held_out: true, prompt: "", entry, cases };
  const extraPrims = opts.std ? [...stdPrims, ...(opts.extraPrims ?? [])] : opts.extraPrims;
  const r: SynthResult | null = await solveBySynthesis(opts.tools ?? [], kata, {
    rounds: opts.rounds, maxEvals: opts.maxEvals, extraPrims,
  });
  if (!r) return { ok: false, reason: "not_found" };
  if (opts.verify !== false) { const v = await grade(r.code, kata); if (!v.passed) return { ok: false, reason: "unverified" }; }
  // `ast` = la receta como AST (no solo el string): es lo que consume `learn()` para minar abstracciones reutilizables.
  return { ok: true, code: r.code, recipe: r.recipeStr, size: r.size, entry, ast: r.recipe };
}

// Superficie completa para usos avanzados (composición, aprendizaje de librería, verificación independiente).
export { solveBySynthesis, buildOps, codeFromRecipe, describeRecipe, type Recipe, type Op, type SynthResult, type SeedPrim } from "./synth.js";
export { learnAbstractions, learnBestAbstraction, proposeAbstractions, type Abstraction } from "./abstract.js";
export { grade, stripFences, deriveCases, enrichCases, type Kata, type Verdict } from "./krites.js";
export { type Tool, type ToolSig, valType, inferSig } from "./tools.js";
export { runSandboxed } from "./sandbox.js";
export { stdPrims, datePrims, numberPrims, regexPrims } from "./prims.js";
export { physicsPrims, chemPrims, sciencePrims } from "./domain.js";
export { emitPython, type TargetLang } from "./emit.js";
export { learn, serializeLibrary, loadLibrary, type LearnResult, type Learnable } from "./library.js";
