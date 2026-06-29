// APRENDIZAJE DE LIBRERÍA (abstracción / "sleep"). Wake = resolver (synth) y guardar la RECETA (AST).
// Sleep = minar sub-recetas RECURRENTES entre las soluciones, generalizarlas (args→huecos, constantes fijas) a
// ABSTRACCIONES parametrizadas, rankearlas por ahorro de longitud de descripción (MDL) y emitirlas como
// herramientas nuevas VERIFICADAS. Efecto: la librería COMPRIME al crecer y la profundidad efectiva de
// composición sube (una abstracción = varios pasos primitivos) → "entrena mejor solo" (DreamCoder/LILO).
import { runSandboxed } from "./sandbox.js";
import { buildOps, type Op, type Recipe } from "./synth.js";
import type { Tool } from "./tools.js";

// Patrón = receta con los args lifteados a HUECOS (parámetros) y las constantes FIJAS; ops por NOMBRE
// (estable entre recetas, a diferencia del índice → seguro de acumular en el bucle vivo aunque la librería crezca).
export type Pattern =
  | { k: "hole"; id: number }
  | { k: "const"; v: any }
  | { k: "app"; op: string; args: Pattern[] }
  | { k: "map"; op: string; arr: Pattern }
  | { k: "fold"; op: string; init: Pattern; arr: Pattern }
  | { k: "zip"; op: string; a: Pattern; b: Pattern };

/** Convierte una receta en patrón: cada arg → hueco (canónico por orden de 1ª aparición), const fija. */
function toPattern(r: Recipe, ops: Op[], holes: Map<number, number>): Pattern {
  switch (r.k) {
    case "arg": { if (!holes.has(r.i)) holes.set(r.i, holes.size); return { k: "hole", id: holes.get(r.i)! }; }
    case "const": return { k: "const", v: r.v };
    case "app": return { k: "app", op: ops[r.op].name, args: r.args.map((a) => toPattern(a, ops, holes)) };
    case "map": return { k: "map", op: ops[r.op].name, arr: toPattern(r.arr, ops, holes) };
    case "fold": return { k: "fold", op: ops[r.op].name, init: toPattern(r.init, ops, holes), arr: toPattern(r.arr, ops, holes) };
    case "zip": return { k: "zip", op: ops[r.op].name, a: toPattern(r.a, ops, holes), b: toPattern(r.b, ops, holes) };
  }
}
/** Todas las raíces de subárbol de una receta (para buscar sub-programas recurrentes). */
function subtrees(r: Recipe, out: Recipe[]): void {
  out.push(r);
  if (r.k === "app") r.args.forEach((a) => subtrees(a, out));
  else if (r.k === "map") subtrees(r.arr, out);
  else if (r.k === "fold") { subtrees(r.init, out); subtrees(r.arr, out); }
  else if (r.k === "zip") { subtrees(r.a, out); subtrees(r.b, out); }
}
/** Subárboles de un PATRÓN (para minar recurrencia sobre patrones ya capturados). */
function patSubtrees(p: Pattern, out: Pattern[]): void {
  out.push(p);
  if (p.k === "app") p.args.forEach((a) => patSubtrees(a, out));
  else if (p.k === "map") patSubtrees(p.arr, out);
  else if (p.k === "fold") { patSubtrees(p.init, out); patSubtrees(p.arr, out); }
  else if (p.k === "zip") { patSubtrees(p.a, out); patSubtrees(p.b, out); }
}
/** Re-canoniza los huecos de un patrón a 0..k por orden de 1ª aparición (un subárbol puede heredar ids no densos). */
function canonPattern(p: Pattern): Pattern {
  const map = new Map<number, number>();
  const walk = (q: Pattern): Pattern => {
    switch (q.k) {
      case "hole": { if (!map.has(q.id)) map.set(q.id, map.size); return { k: "hole", id: map.get(q.id)! }; }
      case "const": return q;
      case "app": return { k: "app", op: q.op, args: q.args.map(walk) };
      case "map": return { k: "map", op: q.op, arr: walk(q.arr) };
      case "fold": return { k: "fold", op: q.op, init: walk(q.init), arr: walk(q.arr) };
      case "zip": return { k: "zip", op: q.op, a: walk(q.a), b: walk(q.b) };
    }
  };
  return walk(p);
}
function patKey(p: Pattern): string {
  switch (p.k) {
    case "hole": return `H${p.id}`;
    case "const": return JSON.stringify(p.v);
    case "app": return `${p.op}(${p.args.map(patKey).join(",")})`;
    case "map": return `map:${p.op}(${patKey(p.arr)})`;
    case "fold": return `fold:${p.op}(${patKey(p.init)},${patKey(p.arr)})`;
    case "zip": return `zip:${p.op}(${patKey(p.a)},${patKey(p.b)})`;
  }
}
function patSize(p: Pattern): number {
  if (p.k === "hole" || p.k === "const") return 1;
  if (p.k === "app") return 1 + p.args.reduce((s, a) => s + patSize(a), 0);
  if (p.k === "map") return 1 + patSize(p.arr);
  if (p.k === "zip") return 1 + patSize(p.a) + patSize(p.b);
  return 1 + patSize(p.init) + patSize(p.arr);
}
/** ALTURA del patrón (torre de composición, MAX entre ramas) — la profundidad efectiva que encapsula la abstracción.
 *  Se usa como `level` de la herramienta-abstracción → al reusarla, cuenta su profundidad interna (torres reales). */
function patDepth(p: Pattern): number {
  switch (p.k) {
    case "hole": case "const": return 0;
    case "app": return 1 + Math.max(0, ...p.args.map(patDepth));
    case "map": return 1 + patDepth(p.arr);
    case "zip": return 1 + Math.max(patDepth(p.a), patDepth(p.b));
    case "fold": return 1 + Math.max(patDepth(p.init), patDepth(p.arr));
  }
}
function patArity(p: Pattern): number {
  let max = -1;
  const walk = (q: Pattern) => {
    if (q.k === "hole") max = Math.max(max, q.id);
    else if (q.k === "app") q.args.forEach(walk);
    else if (q.k === "map") walk(q.arr);
    else if (q.k === "fold") { walk(q.init); walk(q.arr); }
    else if (q.k === "zip") { walk(q.a); walk(q.b); }
  };
  walk(p); return max + 1;
}
/** Variable JS para una op (por nombre saneado) y la expresión del patrón con huecos = parámetros. */
const opVar = (name: string) => `__o_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
function patExpr(p: Pattern): string {
  switch (p.k) {
    case "hole": return `__p[${p.id}]`;
    case "const": return JSON.stringify(p.v);
    case "app": return `${opVar(p.op)}(${p.args.map(patExpr).join(",")})`;
    case "map": return `(${patExpr(p.arr)}).map((__x)=>${opVar(p.op)}(__x))`;
    case "fold": return `(${patExpr(p.arr)}).reduce((__a,__x)=>${opVar(p.op)}(__a,__x), ${patExpr(p.init)})`;
    case "zip": return `(${patExpr(p.a)}).map((__x,__j)=>${opVar(p.op)}(__x,(${patExpr(p.b)})[__j]))`;
  }
}
function usedOpNames(p: Pattern, set: Set<string>): void {
  if (p.k === "app") { set.add(p.op); p.args.forEach((a) => usedOpNames(a, set)); }
  else if (p.k === "map") { set.add(p.op); usedOpNames(p.arr, set); }
  else if (p.k === "fold") { set.add(p.op); usedOpNames(p.init, set); usedOpNames(p.arr, set); }
  else if (p.k === "zip") { set.add(p.op); usedOpNames(p.a, set); usedOpNames(p.b, set); }
}
/** Código `solve(...__p)` autónomo de la abstracción (inyecta las defs de las ops que usa, por nombre). */
function emitPatternCode(p: Pattern, ops: Op[]): string {
  const names = new Set<string>(); usedOpNames(p, names);
  const byName = new Map(ops.map((o) => [o.name, o.src]));
  const defs = [...names].map((n) => `const ${opVar(n)}=${byName.get(n)};`).join("\n");
  return `${defs}\nfunction solve(...__p){ return ${patExpr(p)}; }`;
}
function shortHash(s: string): string {
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 6);
}

export type Abstraction = { name: string; arity: number; code: string; key: string; gain: number; occurs: number; size: number; depth: number };

type MineOpts = { minSize?: number; maxArity?: number; minOccur?: number };
/** Núcleo de minería: cuenta sub-patrones CANÓNICOS recurrentes y emite abstracciones rankeadas por ahorro MDL. */
function mineFromSubPatterns(subPatterns: Pattern[], opsForEmit: Op[], opts: MineOpts): Abstraction[] {
  const minSize = opts.minSize ?? 3, maxArity = opts.maxArity ?? 3, minOccur = opts.minOccur ?? 2;
  const counts = new Map<string, { pat: Pattern; n: number }>();
  for (const pat of subPatterns) {
    if (patSize(pat) < minSize) continue;
    const ar = patArity(pat); if (ar < 1 || ar > maxArity) continue;
    const key = patKey(pat);
    const e = counts.get(key); if (e) e.n++; else counts.set(key, { pat, n: 1 });
  }
  const out: Abstraction[] = [];
  for (const [key, { pat, n }] of counts) {
    if (n < minOccur) continue;
    const size = patSize(pat), arity = patArity(pat);
    const gain = n * (size - 1) - size; // ahorro ≈ (usos × pasos ahorrados) − coste de definirla
    if (gain <= 0) continue;
    out.push({ name: `abs-${shortHash(key)}`, arity, code: emitPatternCode(pat, opsForEmit), key, gain, occurs: n, size, depth: patDepth(pat) });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Propone abstracciones desde RECETAS (cada subárbol → patrón canónico). Para uso con una lista de ops fija. */
export function proposeAbstractions(recipes: Recipe[], ops: Op[], opts: MineOpts = {}): Abstraction[] {
  const subs: Pattern[] = [];
  for (const r of recipes) { const rs: Recipe[] = []; subtrees(r, rs); for (const s of rs) subs.push(toPattern(s, ops, new Map())); }
  return mineFromSubPatterns(subs, ops, opts);
}

/** Convierte una receta a patrón canónico (ops por NOMBRE) usando la librería del MOMENTO de resolución. Capturar
 *  esto al resolver evita el desfase de índices cuando la librería crece después (uso en el bucle vivo). */
export function recipeToPattern(recipe: Recipe, tools: Tool[]): Pattern {
  return toPattern(recipe, buildOps(tools), new Map());
}

/** Sanity-eval por subproceso: ejecuta la abstracción sobre una tupla de prueba; confirma que corre. */
async function probe(code: string, args: any[]): Promise<any | null> {
  const harness = `${code}\ntry{ const r=solve(...${JSON.stringify(args)}); console.log(JSON.stringify(r===undefined?null:r)); }catch{ console.log("null"); }`;
  const { out } = await runSandboxed(harness, 4000); // sandbox endurecido
  try { return JSON.parse(out.trim().split(/\r?\n/).pop() || "null"); } catch { return null; }
}

/** Convierte una abstracción en herramienta registrable (arity correcta + sanity-probe de que ejecuta). */
export async function abstractionToTool(a: Abstraction): Promise<Tool | null> {
  // Probamos con números; si no produce salida, con arrays de números (cripto/colecciones).
  const numArgs = Array.from({ length: a.arity }, () => 3);
  let out = await probe(a.code, numArgs); let inT = "number"; let args: any[] = numArgs;
  if (out === null) { const arr = Array.from({ length: a.arity }, () => [1, 2, 3]); out = await probe(a.code, arr); inT = "array"; args = arr; }
  if (out === null) return null; // no ejecuta limpio → no la registramos (honesto)
  return {
    // level = profundidad INTERNA de la abstracción → al reusarla, `effectiveDepth` cuenta su altura real (torres
    // suben más rápido) en vez de contarla como 1 paso (antes level:0 → la compresión no elevaba el nivel).
    id: a.name, name: a.name, kind: "abstraction", level: Math.max(1, a.depth), code: a.code, entry: "solve",
    sig: { inputs: Array(a.arity).fill(inT), output: Array.isArray(out) ? "array" : typeof out },
    cases: [{ args, expect: out }],
  };
}

/** Paso "sleep": de las recetas resueltas, devuelve hasta `max` abstracciones nuevas verificadas (rankeadas
 *  por ahorro MDL, sin duplicar las existentes). Cada una ejecuta limpio (sanity-probe). */
export async function learnAbstractions(recipes: Recipe[], tools: Tool[], max = 5): Promise<{ tool: Tool; abstraction: Abstraction }[]> {
  const ops = buildOps(tools);
  const existing = new Set(tools.map((t) => t.name));
  const out: { tool: Tool; abstraction: Abstraction }[] = [];
  for (const a of proposeAbstractions(recipes, ops)) {
    if (existing.has(a.name)) continue;
    const tool = await abstractionToTool(a);
    if (tool) { out.push({ tool, abstraction: a }); if (out.length >= max) break; }
  }
  return out;
}

/** La MEJOR abstracción nueva (atajo de `learnAbstractions`). null si no hay ganancia. */
export async function learnBestAbstraction(recipes: Recipe[], tools: Tool[]): Promise<{ tool: Tool; abstraction: Abstraction } | null> {
  return (await learnAbstractions(recipes, tools, 1))[0] ?? null;
}

/** "Sleep" del bucle vivo: mina PATRONES ya capturados (estables ante el crecimiento de la librería) y emite
 *  hasta `max` abstracciones nuevas verificadas, usando la librería ACTUAL para reconstruir el código. */
export async function learnFromPatterns(patterns: Pattern[], tools: Tool[], max = 1): Promise<{ tool: Tool; abstraction: Abstraction }[]> {
  const ops = buildOps(tools);
  const existing = new Set(tools.map((t) => t.name));
  const subs: Pattern[] = [];
  for (const p of patterns) { const ps: Pattern[] = []; patSubtrees(p, ps); for (const s of ps) subs.push(canonPattern(s)); }
  const out: { tool: Tool; abstraction: Abstraction }[] = [];
  for (const a of mineFromSubPatterns(subs, ops, {})) {
    if (existing.has(a.name)) continue;
    const tool = await abstractionToTool(a);
    if (tool) { out.push({ tool, abstraction: a }); if (out.length >= max) break; }
  }
  return out;
}
