// Lógica PURA de la herramienta MCP — separada del wiring del servidor para poder probarla sin levantar stdio
// (ver smoke.ts). Envuelve `synthesize` de Synthcore: dado ejemplos I/O devuelve una función VERIFICADA (o no_found),
// opcionalmente con bundles opt-in (fechas/ciencia) y transpilada a Python. Determinista, $0, offline.
import {
  synthesize,
  emitPython,
  physicsPrims,
  chemPrims,
  sciencePrims,
  type Example,
  type SeedPrim,
} from "synthcore";

export type Bundle = "std" | "physics" | "chem" | "science";
export type Language = "js" | "python";

const EXTRA: Record<Exclude<Bundle, "std">, SeedPrim[]> = {
  physics: physicsPrims,
  chem: chemPrims,
  science: sciencePrims,
};

export type SynthInput = { examples: Example[]; bundle?: Bundle; language?: Language };
export type SynthOutput =
  | { ok: true; recipe: string; language: Language; code: string; size: number }
  | { ok: false; reason: string };

/** Sintetiza y, si se pide, transpila — reusando el MISMO contexto de primitivas en synth y en emit. */
export async function runSynthesize({ examples, bundle, language = "js" }: SynthInput): Promise<SynthOutput> {
  const std = bundle === "std";
  const extraPrims = bundle && bundle !== "std" ? EXTRA[bundle] : undefined;

  const r = await synthesize(examples, { std, extraPrims });
  if (!r.ok) return { ok: false, reason: r.reason };

  const code = language === "python" ? emitPython(r.ast, { std, extraPrims }) : r.code;
  return { ok: true, recipe: r.recipe, language, code, size: r.size };
}
