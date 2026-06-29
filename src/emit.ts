// EMISIÓN MULTI-LENGUAJE (v2) — transpila la RECETA (AST) a otro lenguaje destino. El motor sintetiza un AST
// independiente del lenguaje (`Recipe`); `emitCode` en synth.ts lo baja a JS, y aquí lo bajamos a Python. La
// búsqueda NO cambia: es un pasador de salida adicional sobre el mismo AST verificado. Honestidad: solo se
// transpilan las primitivas del DSL base + los bundles que mantenemos (std, dominio), porque para esas conocemos
// el equivalente exacto en el destino. Una tool/abstracción aprendida o un `extraPrim` arbitrario (JS inyectado por
// un LLM) NO se transpila — lanzamos un error claro con el nombre del op en vez de emitir código incorrecto.
import { buildOps, type Recipe, type Op, type SeedPrim } from "./synth.js";
import { stdPrims } from "./prims.js";
import type { Tool } from "./tools.js";

export type TargetLang = "python";

// Registro Python: nombre de op → (args-ya-emitidos) → expresión Python. `need` declara imports requeridos.
type PyTpl = { fn: (a: string[]) => string; need?: ("math" | "json" | "functools")[] };
const PY: Record<string, PyTpl> = {
  // Aritmética
  add: { fn: ([a, b]) => `(${a} + ${b})` },
  sub: { fn: ([a, b]) => `(${a} - ${b})` },
  mul: { fn: ([a, b]) => `(${a} * ${b})` },
  mod: { fn: ([a, b]) => `((((${a}) % (${b})) + (${b})) % (${b})) if ${b} else 0` },
  idiv: { fn: ([a, b]) => `(math.trunc((${a}) / (${b})) if ${b} else 0)`, need: ["math"] },
  lt: { fn: ([a, b]) => `(1 if ${a} < ${b} else 0)` },
  gt: { fn: ([a, b]) => `(1 if ${a} > ${b} else 0)` },
  eq: { fn: ([a, b]) => `(1 if ${a} == ${b} else 0)` },
  neg: { fn: ([a]) => `(-(${a}))` },
  inc: { fn: ([a]) => `(${a} + 1)` },
  dec: { fn: ([a]) => `(${a} - 1)` },
  round: { fn: ([a]) => `round(${a})` },
  floor: { fn: ([a]) => `math.floor(${a})`, need: ["math"] },
  ceil: { fn: ([a]) => `math.ceil(${a})`, need: ["math"] },
  // Secuencias
  len: { fn: ([x]) => `len(${x})` },
  at: { fn: ([x, i]) => `(${x})[((${i}) % len(${x}) + len(${x})) % len(${x})]` },
  concat: { fn: ([a, b]) => `((${a}) + (${b}))` },
  rev: { fn: ([x]) => `(${x})[::-1]` },
  code: { fn: ([c]) => `ord((${c})[0])` },
  chr: { fn: ([n]) => `chr(((${n}) % 65536 + 65536) % 65536)` },
  chars: { fn: ([s]) => `list(${s})` },
  join: { fn: ([a]) => `''.join(map(str, ${a}))` },
  sum: { fn: ([a]) => `sum(${a})` },
  // Texto
  upper: { fn: ([s]) => `(${s}).upper()` },
  lower: { fn: ([s]) => `(${s}).lower()` },
  trim: { fn: ([s]) => `(${s}).strip()` },
  words: { fn: ([s]) => `(${s}).split()` },
  capitalize: { fn: ([s]) => `((${s})[:1].upper() + (${s})[1:].lower())` },
  split: { fn: ([s, sep]) => `(${s}).split(${sep})` },
  joinWith: { fn: ([a, sep]) => `(${sep}).join(map(str, ${a}))` },
  remove: { fn: ([s, w]) => `(${s}).replace(${w}, '')` },
  // JSON / objetos
  parseJSON: { fn: ([s]) => `json.loads(${s})`, need: ["json"] },
  get: { fn: ([o, k]) => `(${o}).get(${k})` },
  keys: { fn: ([o]) => `list((${o}).keys())` },
  values: { fn: ([o]) => `list((${o}).values())` },
  // Búsqueda / orden
  sort: { fn: ([a]) => `sorted(${a})` },
  max: { fn: ([a]) => `max(${a})` },
  min: { fn: ([a]) => `min(${a})` },
  range: { fn: ([n]) => `list(range(min(int(${n}), 64)))` },
  // stdPrims (fechas/números) — equivalentes Python deterministas (UTC).
  year: { fn: ([s]) => `__dt(${s}).year`, need: ["math"] },
  month: { fn: ([s]) => `__dt(${s}).month` },
  day: { fn: ([s]) => `__dt(${s}).day` },
  weekday: { fn: ([s]) => `((__dt(${s}).weekday() + 1) % 7)` },
  num: { fn: ([s]) => `float(__num_match(${s}))` },
  digits: { fn: ([s]) => `__digits_match(${s})` },
  // domain.ts — física
  momentum: { fn: ([m, v]) => `((${m}) * (${v}))` },
  force: { fn: ([m, a]) => `((${m}) * (${a}))` },
  kinetic: { fn: ([m, v]) => `(0.5 * (${m}) * (${v}) * (${v}))` },
  weight: { fn: ([m]) => `((${m}) * 9.80665)` },
  ohmV: { fn: ([i, r]) => `((${i}) * (${r}))` },
  power: { fn: ([v, i]) => `((${v}) * (${i}))` },
  density: { fn: ([m, vol]) => `((${m}) / (${vol}))` },
  freqToWave: { fn: ([f]) => `(299792458 / (${f}))` },
  massEnergy: { fn: ([m]) => `((${m}) * 299792458 * 299792458)` },
  gravPE: { fn: ([m, h]) => `((${m}) * 9.80665 * (${h}))` },
  workWUT: { fn: ([f, d, th]) => `((${f}) * (${d}) * math.cos(${th}))`, need: ["math"] },
  // domain.ts — química
  moles: { fn: ([mass, mm]) => `((${mass}) / (${mm}))` },
  molarity: { fn: ([n, vol]) => `((${n}) / (${vol}))` },
  dilution: { fn: ([c, v]) => `((${c}) * (${v}))` },
  pH: { fn: ([h]) => `(-math.log10(${h}))`, need: ["math"] },
  pOH: { fn: ([oh]) => `(14 + math.log10(${oh}))`, need: ["math"] },
  celsiusToK: { fn: ([c]) => `((${c}) + 273.15)` },
  idealGasP: { fn: ([n, t, v]) => `((${n}) * 8.314 * (${t}) / (${v}))` },
};

function pyTpl(name: string): PyTpl {
  const t = PY[name];
  if (!t) throw new Error(`emit(python): no hay plantilla para el op '${name}'. Solo se transpilan el DSL base + bundles std/dominio; las tools/abstracciones aprendidas y los extraPrims arbitrarios (JS) no se transpilan.`);
  return t;
}

const needs = new Set<string>();
function emitPyExpr(r: Recipe, ops: Op[]): string {
  switch (r.k) {
    case "arg": return `a[${r.i}]`;
    case "const": return JSON.stringify(r.v);
    case "app": { const t = pyTpl(ops[r.op].name); t.need?.forEach((n) => needs.add(n)); return t.fn(r.args.map((x) => emitPyExpr(x, ops))); }
    case "map": { const t = pyTpl(ops[r.op].name); t.need?.forEach((n) => needs.add(n)); return `[${t.fn(["__x"])} for __x in ${emitPyExpr(r.arr, ops)}]`; }
    case "fold": { const t = pyTpl(ops[r.op].name); t.need?.forEach((n) => needs.add(n)); needs.add("functools"); return `functools.reduce(lambda __acc, __x: ${t.fn(["__acc", "__x"])}, ${emitPyExpr(r.arr, ops)}, ${emitPyExpr(r.init, ops)})`; }
    case "zip": { const t = pyTpl(ops[r.op].name); t.need?.forEach((n) => needs.add(n)); const b = emitPyExpr(r.b, ops); return `[${t.fn(["__x", `(${b})[__j]`])} for __j, __x in enumerate(${emitPyExpr(r.a, ops)})]`; }
  }
}

// Helpers Python embebidos solo si se usan (fechas/números). Mantienen el determinismo (UTC) del bundle std.
const PY_HELPERS: Record<string, string> = {
  __dt: "def __dt(s):\n    from datetime import datetime, timezone\n    return datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(timezone.utc)",
  __num_match: "def __num_match(s):\n    import re\n    m = re.search(r'-?\\d[\\d,]*\\.?\\d*', str(s))\n    return m.group(0).replace(',', '') if m else None",
  __digits_match: "def __digits_match(s):\n    import re\n    m = re.search(r'\\d+', str(s))\n    return m.group(0) if m else None",
};

/**
 * Transpila una receta sintetizada a Python autónomo. Pasa los MISMOS `tools`/`extraPrims`/`std` que usaste en
 * `synthesize` (el AST referencia ops por índice, reconstruido idéntico). Para el caso común (solo DSL base),
 * basta `emitPython(result.ast)`.
 */
export function emitPython(
  ast: Recipe,
  opts: { tools?: Tool[]; extraPrims?: SeedPrim[]; std?: boolean; entry?: string } = {},
): string {
  needs.clear();
  // Reconstruye el array de ops EXACTAMENTE como synthesize (prims base, luego extra, luego tools).
  const stdBundle = opts.std ? stdPrims : [];
  const ops = buildOps(opts.tools ?? [], [...stdBundle, ...(opts.extraPrims ?? [])]);
  const entry = (String(opts.entry || "solve").match(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/) || ["solve"])[0];
  const body = emitPyExpr(ast, ops);
  const imports = [...needs].filter((n) => n === "math" || n === "json" || n === "functools").sort().map((n) => `import ${n}`);
  const used = new Set<string>();
  Object.keys(PY_HELPERS).forEach((h) => { if (body.includes(h + "(")) used.add(h); });
  const helpers = [...used].map((h) => PY_HELPERS[h]);
  const head = [...imports, ...helpers].join("\n");
  return `${head ? head + "\n\n" : ""}def ${entry}(*a):\n    return ${body}\n`;
}
