// SINTETIZADOR (resolver SIN LLM). Sintetiza programas sobre un DSL de COMBINADORES: aplicación n-aria de
// herramientas/primitivas, COMBINAR dos resultados (f(g(x), h(y))), map y fold. Búsqueda BOTTOM-UP con poda por
// EQUIVALENCIA OBSERVACIONAL (dedup por el vector de salidas sobre los casos de la kata) — la poda exponencial que
// la hace tratable. Toda la enumeración corre en UN subproceso y devuelve una RECETA (AST) que el padre reconstruye
// como código `solve` autónomo, verificable por el grader y registrable como herramienta nueva.
import { runSandboxed } from "./sandbox.js";
import { stripFences, type Kata } from "./krites.js";
import { policy } from "./policy.js";
import type { Tool } from "./tools.js";

// Modo LITE (`SYNTHCORE_LITE=1`): presupuestos reducidos → cada subproceso de síntesis cuesta menos CPU/memoria,
// para caber en una caja pequeña. No afecta al modo normal.
const LITE = process.env.SYNTHCORE_LITE === "1";
const TIMEOUT_MS = LITE ? 20_000 : 30_000;
// SIN CORTE de herramientas: el sintetizador ve la librería ENTERA, no solo las últimas N → las abstracciones
// antiguas útiles no quedan fuera de vista. Configurable por `SYNTHCORE_MAX_TOOLS` si hace falta acotar la caja.
const MAX_TOOLS = Number(process.env.SYNTHCORE_MAX_TOOLS || 100_000);
const DEFAULT_ROUNDS = LITE ? 7 : 9;     // profundidad de composición (expansiones bottom-up)
const DEFAULT_MAX_VALUES = LITE ? 1500 : 3000; // valores distintos por ronda (cota de la explosión)
const DEFAULT_MAX_EVALS = LITE ? 1_000_000 : 3_000_000; // tope global de evaluaciones (guarda dura)

// ── DSL base: primitivas SIEMPRE disponibles (como en DreamCoder: primitivas base + librería aprendida).
// Cada una es una expresión-flecha; se embeben tanto en el harness como en el código final emitido. Elegidas
// para ser generales y crypto-friendly (mod euclídeo, char codes) sin inflar la búsqueda.
// `inputs` = tipos de entrada (para enumeración TIPADA: cada op solo se aplica a operandos compatibles → poda
// la basura como add(array,array)). Vocabulario: number | string | array | seq(array|string) | any.
type Prim = { name: string; arity: number; src: string; inputs: string[] };
const PRIMS: Prim[] = [
  { name: "add", arity: 2, src: "(a,b)=>a+b", inputs: ["number", "number"] },
  { name: "sub", arity: 2, src: "(a,b)=>a-b", inputs: ["number", "number"] },
  { name: "mul", arity: 2, src: "(a,b)=>a*b", inputs: ["number", "number"] },
  { name: "mod", arity: 2, src: "(a,b)=>b?(((a%b)+b)%b):0", inputs: ["number", "number"] },  // mod euclídeo (cripto)
  { name: "idiv", arity: 2, src: "(a,b)=>b?Math.trunc(a/b):0", inputs: ["number", "number"] },
  // CONDICIONALES: comparaciones que devuelven 0/1 (NO un tipo booleano nuevo → no rompe la enumeración
  // tipada). Desbloquean toda la clase de algoritmos con DECISIÓN —antes inexpresable—: valor absoluto, signo,
  // recortar (clamp), máximo/mínimo de DOS escalares, transformaciones condicionales, filtrado por predicado. El
  // patrón es aritmético: select(c,a,b)=c·a+(1−c)·b con c∈{0,1}; sign(x)=gt(x,0)−lt(x,0); abs(x)=x·sign(x). Al
  // volverse herramientas reutilizables (composites), las torres condicionales se amortizan (depth colapsa).
  { name: "lt", arity: 2, src: "(a,b)=>a<b?1:0", inputs: ["number", "number"] },   // a<b → 1/0
  { name: "gt", arity: 2, src: "(a,b)=>a>b?1:0", inputs: ["number", "number"] },   // a>b → 1/0
  { name: "eq", arity: 2, src: "(a,b)=>a===b?1:0", inputs: ["number", "number"] }, // a==b → 1/0
  { name: "neg", arity: 1, src: "(a)=>-a", inputs: ["number"] },
  { name: "inc", arity: 1, src: "(a)=>a+1", inputs: ["number"] },
  { name: "dec", arity: 1, src: "(a)=>a-1", inputs: ["number"] },
  // Formateo numérico: redondeo — moneda, porcentajes, enteros.
  { name: "round", arity: 1, src: "(a)=>Math.round(a)", inputs: ["number"] },
  { name: "floor", arity: 1, src: "(a)=>Math.floor(a)", inputs: ["number"] },
  { name: "ceil", arity: 1, src: "(a)=>Math.ceil(a)", inputs: ["number"] },
  { name: "len", arity: 1, src: "(x)=>(x==null?0:x.length)", inputs: ["seq"] },
  { name: "at", arity: 2, src: "(x,i)=>(x==null?undefined:x[(i%x.length+x.length)%x.length])", inputs: ["seq", "number"] },
  { name: "concat", arity: 2, src: "(a,b)=>Array.isArray(a)?a.concat(b):(''+a+b)", inputs: ["seq", "seq"] },
  { name: "rev", arity: 1, src: "(x)=>Array.isArray(x)?[...x].reverse():(''+x).split('').reverse().join('')", inputs: ["seq"] },
  { name: "code", arity: 1, src: "(c)=>typeof c==='string'?c.charCodeAt(0):c", inputs: ["string"] },     // char → código
  { name: "chr", arity: 1, src: "(n)=>String.fromCharCode(((n%65536)+65536)%65536)", inputs: ["number"] }, // código → char
  { name: "chars", arity: 1, src: "(s)=>typeof s==='string'?s.split(''):s", inputs: ["string"] },          // string → array
  { name: "join", arity: 1, src: "(a)=>Array.isArray(a)?a.join(''):a", inputs: ["array"] },                 // array → string
  { name: "sum", arity: 1, src: "(a)=>Array.isArray(a)?a.reduce((x,y)=>x+y,0):a", inputs: ["array"] },
  // Texto: transformaciones de STRING comunes. Unarias string→string (no necesitan constantes nuevas).
  { name: "upper", arity: 1, src: "(s)=>typeof s==='string'?s.toUpperCase():s", inputs: ["string"] },       // → MAYÚSCULAS
  { name: "lower", arity: 1, src: "(s)=>typeof s==='string'?s.toLowerCase():s", inputs: ["string"] },        // → minúsculas
  { name: "trim", arity: 1, src: "(s)=>typeof s==='string'?s.trim():s", inputs: ["string"] },                 // recorta espacios
  { name: "words", arity: 1, src: "(s)=>typeof s==='string'?s.split(/\\s+/).filter(Boolean):s", inputs: ["string"] }, // → palabras (split por espacios)
  { name: "capitalize", arity: 1, src: "(s)=>typeof s==='string'&&s.length?s[0].toUpperCase()+s.slice(1).toLowerCase():s", inputs: ["string"] }, // "bOB"→"Bob" (capitaliza)
  // Texto con SEPARADOR. Binarias que toman un literal string (de los CONSTANTES MINADOS de los ejemplos) → split
  // por coma/guion/…, unir con separador, quitar ocurrencias. Desbloquea parsear/extraer campos (CSV).
  { name: "split", arity: 2, src: "(s,sep)=>typeof s==='string'?s.split(sep):s", inputs: ["string", "string"] },        // "a,b,c" + "," → [a,b,c]
  { name: "joinWith", arity: 2, src: "(a,sep)=>Array.isArray(a)?a.join(sep):a", inputs: ["array", "string"] },           // [a,b] + "-" → "a-b"
  { name: "remove", arity: 2, src: "(s,w)=>typeof s==='string'&&w!==''?s.split(w).join(''):s", inputs: ["string", "string"] }, // quita ocurrencias
  // JSON: parsear y EXTRAER campos de objetos. La clave de `get` sale de los
  // CONSTANTES MINADOS (incl. claves de los objetos/JSON de los ejemplos) → "extrae el campo email" se sintetiza solo.
  { name: "parseJSON", arity: 1, src: "(s)=>{try{return typeof s==='string'?JSON.parse(s):s}catch(e){return undefined}}", inputs: ["string"] }, // string JSON → objeto/valor
  { name: "get", arity: 2, src: "(o,k)=>(o&&typeof o==='object'&&!Array.isArray(o))?o[k]:undefined", inputs: ["object", "string"] },            // objeto[clave]
  { name: "keys", arity: 1, src: "(o)=>(o&&typeof o==='object')?Object.keys(o):o", inputs: ["object"] },                  // → claves
  { name: "values", arity: 1, src: "(o)=>(o&&typeof o==='object')?Object.values(o):o", inputs: ["object"] },              // → valores
  // RECURSIÓN / BÚSQUEDA: ordenar, mín/máx (búsqueda lineal) y `range` (número→array) que BRIDGEa el dominio
  // numérico al de arrays/búsqueda → habilita tareas de ordenación/búsqueda.
  { name: "sort", arity: 1, src: "(a)=>Array.isArray(a)?[...a].sort((x,y)=>x-y):a", inputs: ["array"] },     // ordenar asc
  { name: "max", arity: 1, src: "(a)=>Array.isArray(a)&&a.length?a.reduce((x,y)=>y>x?y:x):a", inputs: ["array"] }, // búsqueda del máximo
  { name: "min", arity: 1, src: "(a)=>Array.isArray(a)&&a.length?a.reduce((x,y)=>y<x?y:x):a", inputs: ["array"] }, // búsqueda del mínimo
  { name: "range", arity: 1, src: "(n)=>Array.from({length:Math.max(0,Math.min((n|0),64))},(_,i)=>i)", inputs: ["number"] }, // número→array [0..n)
];
const CONSTS = [0, 1, 2, -1, 26, 256]; // constantes elevadas (cripto: 26 alfabeto, 256 byte)

// SIEMBRA DE PRIMITIVAS — la frontera honesta: el motor solo recombina la CLAUSURA de sus primitivas; una operación
// genuinamente nueva (regex, fechas, una S-box) necesita un INTRODUCTOR externo (humano o LLM). v1.0 la inyecta por
// PARÁMETRO —`opts.extraPrims`, o el bundle opcional `stdPrims`— NO por fichero: synthcore no lee disco ni mantiene
// estado global al importar. `extra` en `buildOps` es ese seam (efímero por llamada, sin reiniciar ni persistir).
const ALL_PRIMS: Prim[] = PRIMS;

/** OP = primitiva o herramienta, en UN índice común (recetas referencian por índice). Prims primero. */
export type Op = { name: string; arity: number; src: string; inputs: string[] };
export type SeedPrim = { name: string; arity: number; src: string; inputs?: string[] };
/** `extra` = primitivas EFÍMERAS inyectadas en esta llamada (p.ej. la que el LLM propone, sin reiniciar ni persistir). */
export function buildOps(tools: Tool[], extra: SeedPrim[] = []): Op[] {
  const extraOps: Op[] = extra.map((p) => ({ name: p.name, arity: p.arity, src: p.src, inputs: p.inputs ?? Array(p.arity).fill("any") }));
  const toolOps: Op[] = tools.map((t) => {
    const inputs = t.sig?.inputs ?? (t.cases?.[0]?.args || []).map(() => "any");
    return { name: t.name, arity: inputs.length, src: `(()=>{ ${stripFences(t.code)}; return ${t.entry}; })()`, inputs };
  });
  return [...ALL_PRIMS, ...extraOps, ...toolOps];
}

// ── Receta (AST serializable) que devuelve el harness ──────────────────────────────────────────────
export type Recipe =
  | { k: "arg"; i: number }
  | { k: "const"; v: any }
  | { k: "app"; op: number; args: Recipe[] }
  | { k: "map"; op: number; arr: Recipe }
  | { k: "fold"; op: number; init: Recipe; arr: Recipe }
  | { k: "zip"; op: number; a: Recipe; b: Recipe }; // combinar dos arrays elemento a elemento (cripto)

/** Reconstruye una expresión JS a partir de la receta (usado para emitir el `solve` final). */
function emitExpr(r: Recipe): string {
  switch (r.k) {
    case "arg": return `__a[${r.i}]`;
    case "const": return JSON.stringify(r.v);
    case "app": return `__op${r.op}(${r.args.map(emitExpr).join(",")})`;
    case "map": return `(${emitExpr(r.arr)}).map((__x)=>__op${r.op}(__x))`;
    case "fold": return `(${emitExpr(r.arr)}).reduce((__acc,__x)=>__op${r.op}(__acc,__x), ${emitExpr(r.init)})`;
    case "zip": return `(${emitExpr(r.a)}).map((__x,__j)=>__op${r.op}(__x,(${emitExpr(r.b)})[__j]))`;
  }
}
/** Índices de OPs realmente usados → emitimos solo esas defs (código final limpio). */
function usedOps(r: Recipe, set: Set<number>): void {
  if (r.k === "app") { set.add(r.op); r.args.forEach((a) => usedOps(a, set)); }
  else if (r.k === "map") { set.add(r.op); usedOps(r.arr, set); }
  else if (r.k === "fold") { set.add(r.op); usedOps(r.init, set); usedOps(r.arr, set); }
  else if (r.k === "zip") { set.add(r.op); usedOps(r.a, set); usedOps(r.b, set); }
}
/** Código `solve` autónomo a partir de la receta (entry = el nombre que pide la kata). */
function emitCode(r: Recipe, ops: Op[], entry: string): string {
  const used = new Set<number>(); usedOps(r, used);
  const defs = [...used].map((i) => `const __op${i}=${ops[i].src};`).join("\n");
  return `${defs}\nfunction ${entry}(...__a){ return ${emitExpr(r)}; }`;
}
/** Tamaño de la receta (nodos) — para preferir programas pequeños (Occam) en logs/métricas. */
function recipeSize(r: Recipe): number {
  if (r.k === "arg" || r.k === "const") return 1;
  if (r.k === "app") return 1 + r.args.reduce((s, a) => s + recipeSize(a), 0);
  if (r.k === "map") return 1 + recipeSize(r.arr);
  if (r.k === "zip") return 1 + recipeSize(r.a) + recipeSize(r.b);
  return 1 + recipeSize(r.init) + recipeSize(r.arr);
}

async function spawnHarness(harness: string): Promise<string> {
  const { out } = await runSandboxed(harness, TIMEOUT_MS); // sandbox endurecido (sin env, tope memoria, cwd temp)
  return out.trim().split(/\r?\n/).pop() || "";
}

/** El harness corre la búsqueda bottom-up DENTRO del subproceso (obs-equivalence usa valores reales). */
function buildSearchHarness(ops: Op[], kata: Kata, rounds: number, maxValues: number, maxEvals: number, strConsts: string[] = []): string {
  const opsSrc = `[${ops.map((o) => `{name:${JSON.stringify(o.name)},arity:${o.arity},inputs:${JSON.stringify(o.inputs)},fn:${o.src}}`).join(",")}]`;
  return `
const OPS=${opsSrc};
const CASES=${JSON.stringify(kata.cases)};
const M=CASES.length;
const ARITY=(CASES[0].args||[]).length;
const EXPECT=CASES.map(c=>c.expect);
const TARGET=JSON.stringify(EXPECT);
const ROUNDS=${rounds}, MAXV=${maxValues}, MAXE=${maxEvals};
const UN=[],BIN=[]; OPS.forEach((o,i)=>{ if(o.arity===1)UN.push(i); else if(o.arity===2)BIN.push(i); });
let evals=0, FOUND=null;
const seen=new Set();
const values=[]; // { r, vec, t } donde t = tipo representativo del valor
const keyOf=(vec)=>{ try{ return JSON.stringify(vec); }catch{ return null; } };
// Tipos para enumeración TIPADA (poda add(array,array) y demás basura).
const vt=(v)=>Array.isArray(v)?(v.length&&Array.isArray(v[0])?'matrix':'array'):(v==null?'null':typeof v);
const match=(t,k)=>{ if(t==='any')return true; if(t==='seq')return k==='array'||k==='string'; return t===k; };
const repr=(vec)=>{ for(const x of vec){ const k=vt(x); if(k!=='null')return k; } return 'null'; }; // 1er tipo no nulo
const elemT=(vec)=>{ for(const x of vec){ if(Array.isArray(x)&&x.length)return vt(x[0]); } return 'any'; }; // tipo de elemento
function tryAdd(r, vec){
  if(FOUND) return;
  if(!vec) return;
  for(const x of vec){ if(x===undefined || (typeof x==='number' && !isFinite(x))) return; }
  const k=keyOf(vec); if(k===null||seen.has(k)) return;
  seen.add(k); values.push({r,vec,t:repr(vec)});
  if(k===TARGET) FOUND=r;
}
function applyVec(fn){ // produce vec de M componentes o null si alguna lanza/da undefined
  const out=new Array(M);
  for(let i=0;i<M;i++){ evals++; try{ const v=fn(i); if(v===undefined) return null; out[i]=v; }catch{ return null; } }
  return out;
}
// Semillas: argumentos de la kata + constantes
for(let j=0;j<ARITY && !FOUND;j++) tryAdd({k:'arg',i:j}, CASES.map(c=>c.args[j]));
for(const c of ${JSON.stringify(CONSTS)}){ if(FOUND)break; tryAdd({k:'const',v:c}, CASES.map(()=>c)); }
// CONSTANTES STRING MINADAS de los ejemplos (separadores, literales): seed para split/joinWith/remove.
for(const c of ${JSON.stringify(strConsts)}){ if(FOUND)break; tryAdd({k:'const',v:c}, CASES.map(()=>c)); }
// Aplicación DIRECTA de cada op cuya aridad === aridad de la kata, con tipos compatibles.
for(let o=0;o<OPS.length && !FOUND;o++){
  const op=OPS[o]; if(op.arity!==ARITY) continue;
  if(!op.inputs.every((t,j)=>match(t, vt(CASES[0].args[j])))) continue;
  tryAdd({k:'app',op:o,args:Array.from({length:ARITY},(_,j)=>({k:'arg',i:j}))}, applyVec(i=>op.fn(...CASES[i].args)));
}
// Rondas bottom-up: cada ronda combina los valores existentes un nivel más profundo (TIPADO).
for(let round=0; round<ROUNDS && !FOUND && evals<MAXE; round++){
  const snap=values.slice(0, MAXV);
  // unaria + map(unaria), con guarda de tipo
  for(const v of snap){ if(FOUND||evals>=MAXE)break;
    for(const o of UN){ if(FOUND)break; const op=OPS[o];
      if(match(op.inputs[0], v.t)) tryAdd({k:'app',op:o,args:[v.r]}, applyVec(i=>op.fn(v.vec[i])));
      if(v.t==='array' && match(op.inputs[0], elemT(v.vec))) tryAdd({k:'map',op:o,arr:v.r}, applyVec(i=>v.vec[i].map(x=>op.fn(x))));
    }
  }
  // zipWith PRIMERO (combina dos arrays elemento a elemento): es el combinador productivo para tareas sobre
  // colecciones (cripto). Va antes que la aritmética escalar para que sus resultados no se trunquen por MAXV.
  for(const va of snap){ if(FOUND||evals>=MAXE)break;
    if(va.t!=='array') continue; const ea=elemT(va.vec);
    for(const vb of snap){ if(FOUND||evals>=MAXE)break;
      if(vb.t!=='array') continue; const eb=elemT(vb.vec);
      for(const o of BIN){ if(FOUND)break; const op=OPS[o];
        if(!match(op.inputs[0], ea) || !match(op.inputs[1], eb)) continue;
        tryAdd({k:'zip',op:o,a:va.r,b:vb.r}, applyVec(i=>va.vec[i].map((x,j)=>op.fn(x, vb.vec[i][j]))));
      }
    }
  }
  // fold: arr (array) reducido con binaria; op.inputs[1] debe casar el tipo de elemento
  for(const arr of snap){ if(FOUND||evals>=MAXE)break;
    if(arr.t!=='array') continue; const et=elemT(arr.vec);
    for(const init of snap){ if(FOUND)break;
      for(const o of BIN){ if(FOUND)break; const op=OPS[o];
        if(!match(op.inputs[0], init.t) || !match(op.inputs[1], et)) continue;
        tryAdd({k:'fold',op:o,init:init.r,arr:arr.r}, applyVec(i=>arr.vec[i].reduce((acc,x)=>op.fn(acc,x), init.vec[i])));
      }
    }
  }
  // binaria sobre pares de ESCALARES compatibles (combinar dos resultados: f(g(x),h(y))) — al final.
  for(let a=0;a<snap.length && !FOUND && evals<MAXE;a++){
    const va=snap[a];
    for(let b=0;b<snap.length && !FOUND && evals<MAXE;b++){
      const vb=snap[b];
      for(const o of BIN){ if(FOUND||evals>=MAXE)break; const op=OPS[o];
        if(!match(op.inputs[0], va.t) || !match(op.inputs[1], vb.t)) continue;
        tryAdd({k:'app',op:o,args:[va.r,vb.r]}, applyVec(i=>op.fn(va.vec[i],vb.vec[i])));
      }
    }
  }
}
console.log(JSON.stringify(FOUND));
`;
}

export type SynthResult = { code: string; size: number; recipe: Recipe; recipeStr: string };

// RETRIEVAL PRIORIZADO (reordena, NO recorta: ninguna herramienta se descarta). El buscador bottom-up llena
// su pool de valores en orden de OPs y lo trunca a MAX_VALUES; poniendo delante las herramientas más PROMETEDORAS,
// sus aplicaciones entran en el pool ANTES del corte → la búsqueda converge con menos presupuesto. Señales baratas:
// (1) RELEVANCIA de firma (la salida/entrada de la tool casa con los tipos de la kata), (2) ABSTRACCIONES (compresión
// MDL, los building-blocks más reutilizables), (3) RECENCIA (frontera actual). Sin coste extra (solo un sort).
const vt = (v: any): string => Array.isArray(v) ? "array" : v == null ? "null" : typeof v;
function rankTools(tools: Tool[], kata: Kata): Tool[] {
  const want = vt(kata.cases[0].expect);
  const argTypes = (kata.cases[0].args || []).map(vt);
  const score = (t: Tool): number => {
    let s = 0;
    const out = t.sig?.output, ins = t.sig?.inputs || [];
    if (out && (out === want || (out === "string" && want === "string"))) s += 2; // produce el tipo buscado
    if (ins.some((it) => argTypes.includes(it))) s += 1;                          // consume un tipo de la kata
    if (t.kind === "abstraction") s += 2;                                          // building-block MDL reutilizable
    // BÚSQUEDA GUIADA (policy, $0): éxito histórico de la tool → prioridad (saturado: log para no dominar la relevancia).
    s += Math.min(3, Math.log2(1 + policy.score(t.name)));
    return s;
  };
  // Estable por RECENCIA: índice mayor = más reciente → empata a favor de lo cercano a la frontera.
  return tools
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .map((x) => x.t);
}

// MINADO DE CONSTANTES STRING. El motor no tiene literales de texto; los EXTRAE de los propios ejemplos:
// separadores comunes + cada carácter distinto que aparece en las entradas + las cadenas de SALIDA cortas (para
// tareas de salida fija). Acotado para no inflar la búsqueda. Así "separa por comas" / "extrae el 2º campo" se
// sintetizan (split(arg0,",") + at(...,1)) sin que se dé el separador a mano.
function mineStringConsts(kata: Kata): string[] {
  const out = new Set<string>([",", " ", "-", ".", ":", "/", "|", "_", ";"]); // separadores comunes
  const keys = (v: any) => { // recoge CLAVES de objetos (anidados) → `get(obj,"email")` sintetizable
    if (Array.isArray(v)) v.forEach(keys);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) { out.add(k); keys(v[k]); }
  };
  for (const c of kata.cases.slice(0, 6)) {
    for (const v of [...(c.args || []), c.expect]) {
      if (typeof v === "string") {
        for (const ch of new Set(v.split(""))) out.add(ch);    // cada carácter distinto de la entrada/salida
        if (v.length > 0 && v.length <= 10) out.add(v);         // cadena corta entera (salida fija / literal)
        try { keys(JSON.parse(v)); } catch { /* no era JSON */ } // claves de un string JSON parseable
      } else keys(v);                                            // claves de un objeto/array directo
    }
  }
  return [...out].slice(0, 64); // cota dura
}

/** Ante una kata, intenta sintetizar `solve` componiendo el DSL base + la librería de herramientas, SIN LLM.
 *  Devuelve el código + la receta, o null si no encuentra programa dentro del presupuesto. */
export async function solveBySynthesis(
  allTools: Tool[], kata: Kata,
  opts: { rounds?: number; maxValues?: number; maxEvals?: number; maxTools?: number; extraPrims?: SeedPrim[] } = {},
): Promise<SynthResult | null> {
  if (!kata.cases?.length || !(kata.cases[0].args)) return null;
  const tools = rankTools(allTools.slice(-(opts.maxTools ?? MAX_TOOLS)), kata);
  const extra = opts.extraPrims ?? [];
  const ops = buildOps(tools, extra);
  const harness = buildSearchHarness(
    ops, kata, opts.rounds ?? DEFAULT_ROUNDS, opts.maxValues ?? DEFAULT_MAX_VALUES, opts.maxEvals ?? DEFAULT_MAX_EVALS,
    mineStringConsts(kata),
  );
  const out = await spawnHarness(harness);
  let recipe: Recipe | null = null;
  try { recipe = JSON.parse(out || "null"); } catch { recipe = null; }
  if (!recipe) return null;
  return {
    code: emitCode(recipe, ops, kata.entry),
    size: recipeSize(recipe),
    recipe,
    recipeStr: describe(recipe, ops),
  };
}

/** Descripción legible de la receta (para transcript/logs): p.ej. "map[quark](arg0)" o "add(double(arg0),inc(arg1))". */
function describe(r: Recipe, ops: Op[]): string {
  switch (r.k) {
    case "arg": return `arg${r.i}`;
    case "const": return JSON.stringify(r.v);
    case "app": return `${ops[r.op].name}(${r.args.map((a) => describe(a, ops)).join(",")})`;
    case "map": return `map[${ops[r.op].name}](${describe(r.arr, ops)})`;
    case "fold": return `fold[${ops[r.op].name}](${describe(r.init, ops)},${describe(r.arr, ops)})`;
    case "zip": return `zip[${ops[r.op].name}](${describe(r.a, ops)},${describe(r.b, ops)})`;
  }
}

// ── Reutilizables por otros módulos ─────────────────────────────────────────────────────────────────
export const BASE_CONSTS = CONSTS;
/** Código `solve` autónomo a partir de una receta y la librería de tools (reconstruye los ops). */
export function codeFromRecipe(tools: Tool[], r: Recipe, entry = "solve"): string { return emitCode(r, buildOps(tools), entry); }
/** Descripción legible de una receta dada la librería de tools. */
export function describeRecipe(tools: Tool[], r: Recipe): string { return describe(r, buildOps(tools)); }
