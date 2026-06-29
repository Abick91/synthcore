// APRENDIZAJE DE LIBRERÍA en la API pública (v1.0) — el "se vuelve mejor con el uso". `learn()` toma las recetas de
// soluciones ya encontradas, mina sub-programas recurrentes y los cristaliza en ABSTRACCIONES verificadas (estilo
// DreamCoder/LILO, ranking por compresión MDL). Las abstracciones son `Tool`s normales: pásalas de vuelta como
// `synthesize(ex, { tools })` y el motor resuelve más profundo con el mismo presupuesto. `serializeLibrary` /
// `loadLibrary` persisten esa librería entre sesiones (JSON puro), para que el consumidor haga CRECER la suya.
import { learnAbstractions, type Abstraction } from "./abstract.js";
import type { Recipe } from "./synth.js";
import type { Tool } from "./tools.js";

const LIB_VERSION = 1;

/** Acepta tanto recetas (AST) como resultados de `synthesize` (`{ ast }`) → normaliza a `Recipe[]`. */
export type Learnable = Recipe | { ast: Recipe };
const toRecipe = (x: Learnable): Recipe => ("ast" in (x as any) ? (x as { ast: Recipe }).ast : (x as Recipe));

export type LearnResult = {
  tools: Tool[];                 // librería ACTUALIZADA (las de entrada + las nuevas) — pásala a `synthesize({tools})`
  learned: Tool[];               // solo las abstracciones NUEVAS de esta ronda
  abstractions: Abstraction[];   // metadatos (ganancia MDL, ocurrencias, profundidad) de cada nueva
};

/** Paso "sleep": de las soluciones dadas, aprende hasta `max` abstracciones nuevas verificadas y las añade a `tools`.
 *  IMPORTANTE: las recetas deben provenir de síntesis con la MISMA librería `tools` (los índices de op son relativos
 *  a ella). Para el caso por defecto —`synthesize` sin `tools`/`std`— pasa `tools = []` (o el resultado anterior). */
export async function learn(
  solutions: Learnable[], tools: Tool[] = [], opts: { max?: number } = {},
): Promise<LearnResult> {
  const recipes = (solutions ?? []).map(toRecipe).filter(Boolean);
  const found = await learnAbstractions(recipes, tools, opts.max ?? 5);
  const learned = found.map((f) => f.tool);
  return { tools: [...tools, ...learned], learned, abstractions: found.map((f) => f.abstraction) };
}

/** Serializa una librería de herramientas/abstracciones a JSON (con envelope versionado) para persistir entre sesiones. */
export function serializeLibrary(tools: Tool[]): string {
  return JSON.stringify({ v: LIB_VERSION, tools: tools ?? [] });
}

/** Una `Tool` mínima válida: tiene los campos que el motor necesita para recomponerla y verificarla. */
function isValidTool(t: any): t is Tool {
  return !!t && typeof t.name === "string" && typeof t.code === "string" && typeof t.entry === "string"
    && t.sig && Array.isArray(t.sig.inputs) && typeof t.sig.output === "string" && Array.isArray(t.cases);
}

/** Carga una librería persistida. Tolerante: descarta entradas inválidas (no rompe) en vez de confiar a ciegas. */
export function loadLibrary(json: string): Tool[] {
  try {
    const data = JSON.parse(json);
    const tools = Array.isArray(data) ? data : data?.tools; // admite array pelado o el envelope {v,tools}
    return (Array.isArray(tools) ? tools : []).filter(isValidTool);
  } catch { return []; }
}
