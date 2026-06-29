// PRIMITIVAS DE DOMINIO OPT-IN (v2) — leyes físicas y químicas como primitivas inyectables. Misma mecánica que
// `stdPrims`: NO van en el DSL base (cada una agranda el espacio de búsqueda escalar y sube el sobreajuste), se
// inyectan SOLO si las pides —`synthesize(ex, { extraPrims: physicsPrims })`—. Convierten synthcore en un motor de
// REGRESIÓN SIMBÓLICA VERIFICADA (estilo PySR/Eureqa) pero con garantía exacta: solo devuelve la ley que reproduce
// TODOS los ejemplos, sin error residual. Útil para: descubrir la fórmula tras unos datos, convertir unidades,
// derivar una magnitud de otras. La frontera honesta: datos con RUIDO experimental → usa PySR (minimiza error);
// transformaciones EXACTAS (leyes discretas, conversiones, identidades) → synthcore (verificación exacta).
//
// Reglas de diseño (idénticas a prims.ts):
//  - Cada `src` es función pura que devuelve `undefined` ante entrada inválida → el motor la descarta (no alucina).
//  - Constantes físicas embebidas (g, R, c…) con su valor SI estándar → resultado determinista, sin estado externo.
//  - ARIDAD IMPORTA: el buscador solo COMPONE ops de aridad 1 y 2 en las rondas; las de aridad 3 solo se aplican
//    DIRECTAS (cuando la kata tiene esa aridad). Por eso priorizamos formas de 2 args (componibles) y marcamos las
//    de 3 args como "solo directa".
import type { SeedPrim } from "./synth.js";

/** Física clásica: mecánica, electricidad, ondas. Constantes SI (g=9.80665, c=299792458). */
export const physicsPrims: SeedPrim[] = [
  // Mecánica — aridad 2, COMPONIBLES (entran en las rondas bottom-up).
  { name: "momentum",   arity: 2, src: "(m,v)=>(typeof m==='number'&&typeof v==='number')?m*v:undefined", inputs: ["number", "number"] },        // p = m·v
  { name: "force",      arity: 2, src: "(m,a)=>(typeof m==='number'&&typeof a==='number')?m*a:undefined", inputs: ["number", "number"] },        // F = m·a
  { name: "kinetic",    arity: 2, src: "(m,v)=>(typeof m==='number'&&typeof v==='number')?0.5*m*v*v:undefined", inputs: ["number", "number"] },  // Ec = ½m·v²
  { name: "weight",     arity: 1, src: "(m)=>typeof m==='number'?m*9.80665:undefined", inputs: ["number"] },                                     // W = m·g
  { name: "ohmV",       arity: 2, src: "(i,r)=>(typeof i==='number'&&typeof r==='number')?i*r:undefined", inputs: ["number", "number"] },        // V = I·R
  { name: "power",      arity: 2, src: "(v,i)=>(typeof v==='number'&&typeof i==='number')?v*i:undefined", inputs: ["number", "number"] },        // P = V·I
  { name: "density",    arity: 2, src: "(m,vol)=>(typeof m==='number'&&typeof vol==='number'&&vol)?m/vol:undefined", inputs: ["number", "number"] }, // ρ = m/V
  { name: "freqToWave", arity: 1, src: "(f)=>(typeof f==='number'&&f)?299792458/f:undefined", inputs: ["number"] },                              // λ = c/f
  // Energía/relatividad — aridad 1, COMPONIBLE.
  { name: "massEnergy", arity: 1, src: "(m)=>typeof m==='number'?m*299792458*299792458:undefined", inputs: ["number"] },                         // E = m·c²
  // Aridad 3 — SOLO DIRECTA (la kata debe tener 3 args).
  { name: "gravPE",     arity: 2, src: "(m,h)=>(typeof m==='number'&&typeof h==='number')?m*9.80665*h:undefined", inputs: ["number", "number"] }, // U = m·g·h
  { name: "workWUT",    arity: 3, src: "(f,d,th)=>([f,d,th].every(x=>typeof x==='number'))?f*d*Math.cos(th):undefined", inputs: ["number", "number", "number"] }, // W = F·d·cosθ
];

/** Química: gases ideales, estequiometría, disoluciones. R=8.314 J/(mol·K). */
export const chemPrims: SeedPrim[] = [
  // Aridad 2, COMPONIBLES.
  { name: "moles",      arity: 2, src: "(mass,mm)=>(typeof mass==='number'&&typeof mm==='number'&&mm)?mass/mm:undefined", inputs: ["number", "number"] }, // n = m/M
  { name: "molarity",   arity: 2, src: "(n,vol)=>(typeof n==='number'&&typeof vol==='number'&&vol)?n/vol:undefined", inputs: ["number", "number"] },      // M = n/V
  { name: "dilution",   arity: 2, src: "(c,v)=>(typeof c==='number'&&typeof v==='number')?c*v:undefined", inputs: ["number", "number"] },                 // C·V (factor de dilución)
  // Aridad 1, COMPONIBLES.
  { name: "pH",         arity: 1, src: "(h)=>(typeof h==='number'&&h>0)?-Math.log10(h):undefined", inputs: ["number"] },                                  // pH = -log₁₀[H⁺]
  { name: "pOH",        arity: 1, src: "(oh)=>(typeof oh==='number'&&oh>0)?14+Math.log10(oh):undefined", inputs: ["number"] },                            // pOH = 14+log₁₀[OH⁻]
  { name: "celsiusToK", arity: 1, src: "(c)=>typeof c==='number'?c+273.15:undefined", inputs: ["number"] },                                               // K = °C + 273.15
  // Aridad 3 — SOLO DIRECTA. Ley de los gases ideales: P = nRT/V.
  { name: "idealGasP",  arity: 3, src: "(n,t,v)=>([n,t,v].every(x=>typeof x==='number')&&v)?(n*8.314*t)/v:undefined", inputs: ["number", "number", "number"] },
];

/** Bundle completo de dominio científico: física + química. Pásalo como `extraPrims`. */
export const sciencePrims: SeedPrim[] = [...physicsPrims, ...chemPrims];
