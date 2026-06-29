// Tipo de HERRAMIENTA y utilidades de firma. Una `Tool` es una función verificada con su firma de I/O y los
// vectores que la prueban: la unidad de la LIBRERÍA que el motor compone. El consumidor aporta sus propias Tools.
export type ToolSig = { inputs: string[]; output: string };
export type Tool = {
  id: string; name: string; kind: string; level: number;
  code: string; entry: string; sig: ToolSig;
  cases: { args: any[]; expect: any }[]; // vectores que la verifican (Krités)
  label?: string;
  fp?: string;
  props?: string[];
};

/** Tipo de un valor para encadenar herramientas por compatibilidad de I/O. */
export function valType(v: any): string {
  if (Array.isArray(v)) return v.length && Array.isArray(v[0]) ? "matrix" : "array";
  if (v === null || v === undefined) return "null";
  return typeof v; // "number" | "string" | "boolean" | "object"
}
/** Infiere la firma (tipos de entrada → tipo de salida) a partir del primer caso de test. */
export function inferSig(cases: { args: any[]; expect: any }[]): ToolSig {
  const c = cases[0] || { args: [], expect: null };
  return { inputs: (c.args || []).map(valType), output: valType(c.expect) };
}
