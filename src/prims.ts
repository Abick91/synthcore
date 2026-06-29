// PRIMITIVAS ESTÁNDAR OPT-IN (v1.0) — tipos de datos más ricos para wrangling real: fechas, números embebidos en
// texto y regex. NO van en el DSL base a propósito: cada primitiva agranda el espacio de búsqueda (más lento) y
// sube el riesgo de sobreajuste, así que se inyectan SOLO si las pides —`synthesize(ex, { std: true })` o
// `extraPrims: stdPrims`—. Son el mismo `SeedPrim` que propondría un LLM en el patrón híbrido (ver examples/).
//
// Reglas de diseño (honestidad + determinismo):
//  - Cada `src` es una función pura que devuelve `undefined` ante entrada inválida → el motor la descarta (no alucina).
//  - Las fechas usan UTC → el resultado NO depende de la zona horaria de la máquina (mismo output en CI y en local).
//  - `inputs` usa el vocabulario de tipos del motor (number|string|array|seq|object|any) para la enumeración tipada.
import type { SeedPrim } from "./synth.js";

/** Fechas: de un string de fecha (ISO `2024-03-15`, `2024-03-15T..Z`, etc.) a sus componentes, en UTC. */
export const datePrims: SeedPrim[] = [
  { name: "year",    arity: 1, src: "(s)=>{const d=new Date(s);return isNaN(+d)?undefined:d.getUTCFullYear()}", inputs: ["string"] },
  { name: "month",   arity: 1, src: "(s)=>{const d=new Date(s);return isNaN(+d)?undefined:d.getUTCMonth()+1}", inputs: ["string"] }, // 1..12
  { name: "day",     arity: 1, src: "(s)=>{const d=new Date(s);return isNaN(+d)?undefined:d.getUTCDate()}", inputs: ["string"] },     // 1..31
  { name: "weekday", arity: 1, src: "(s)=>{const d=new Date(s);return isNaN(+d)?undefined:d.getUTCDay()}", inputs: ["string"] },      // 0=domingo
];

/** Números dentro de texto: `"$1,234.50"` → `1234.5`, `"abc42"` → `"42"`. `num` devuelve number; `digits`, string. */
export const numberPrims: SeedPrim[] = [
  { name: "num",    arity: 1, src: "(s)=>{const m=String(s).match(/-?\\d[\\d,]*\\.?\\d*/);return m?parseFloat(m[0].replace(/,/g,'')):undefined}", inputs: ["string"] },
  { name: "digits", arity: 1, src: "(s)=>{const m=String(s).match(/\\d+/);return m?m[0]:undefined}", inputs: ["string"] },
];

/** Regex: `regexExtract`/`regexMatch` toman el patrón como 2º argumento (de los constantes minados o sembrado por un
 *  LLM). Más útiles en el patrón híbrido que en síntesis pura, porque el patrón rara vez aparece en los ejemplos. */
export const regexPrims: SeedPrim[] = [
  { name: "regexExtract", arity: 2, src: "(s,p)=>{try{const m=String(s).match(new RegExp(p));return m?m[0]:undefined}catch(e){return undefined}}", inputs: ["string", "string"] },
  { name: "regexMatch",   arity: 2, src: "(s,p)=>{try{return new RegExp(p).test(String(s))?1:0}catch(e){return undefined}}", inputs: ["string", "string"] }, // 1/0
];

/** Bundle completo opt-in: fechas + números + regex. Pásalo como `extraPrims` o activa `synthesize(ex,{std:true})`. */
export const stdPrims: SeedPrim[] = [...datePrims, ...numberPrims, ...regexPrims];
