// EL PATRÓN HÍBRIDO LLM-SEMBRADOR — la otra mitad de la tesis de synthcore.
//
// La síntesis pura solo recombina la CLAUSURA de su DSL: si una tarea necesita una operación que no existe en el
// vocabulario (base64, una S-box, un parser raro), devuelve `not_found` por mucho presupuesto que le des. Ahí entra
// el LLM, pero en un rol ACOTADO y barato: NO escribe la solución entera (que habría que verificar a mano y podría
// alucinar) — propone UNA primitiva nueva. El motor la verifica y, si desbloquea la tarea, la recompone determinista
// y a $0 para siempre. El LLM introduce lo raro y caro una vez; synthcore hace el trabajo repetible, verificado, gratis.
//
// Corre con:  npx tsx examples/hybrid-llm-seeding.ts
// En tu proyecto importarías desde "synthcore"; aquí usamos la ruta al código fuente del repo.
import { synthesize, type Example, type SeedPrim } from "../src/index.js";

// La tarea: codificar un string a base64. No hay primitiva base64 en el DSL → la síntesis pura no puede.
const examples: Example[] = [
  { input: "hi", output: "aGk=" },
  { input: "abc", output: "YWJj" },
  { input: "synthcore", output: "c3ludGhjb3Jl" },
];

/**
 * Stub del LLM-sembrador. EN PRODUCCIÓN: llamas a un LLM (Claude, etc.) con los ejemplos y le pides UNA primitiva
 * candidata como `{ name, arity, src, inputs }` (una función-flecha JS pura, sin efectos). Parseas su respuesta a un
 * `SeedPrim`. No hace falta que acierte: el motor la VERIFICA contra todos los ejemplos antes de devolver nada, así
 * que una propuesta equivocada simplemente no resuelve (no se cuela código no verificado). Aquí la devolvemos fija.
 */
async function askLLMForPrimitive(_ex: Example[]): Promise<SeedPrim> {
  return {
    name: "b64",
    arity: 1,
    src: "(s)=>typeof s==='string'?Buffer.from(s,'utf8').toString('base64'):undefined",
    inputs: ["string"], // tipos del motor: el argumento es string
  };
}

(async () => {
  console.log("Patrón híbrido LLM-sembrador\n");

  // 1) Intento de síntesis PURA — debe fallar: la operación está fuera del DSL.
  const pure = await synthesize(examples);
  console.log(`1. síntesis pura        → ${pure.ok ? pure.recipe : pure.reason}  (esperado: not_found)`);

  // 2) El LLM propone UNA primitiva (rol acotado, una sola vez).
  const prim = await askLLMForPrimitive(examples);
  console.log(`2. el LLM propone       → primitiva "${prim.name}" (${prim.src})`);

  // 3) El motor la siembra (efímera, por llamada — no toca el DSL ni persiste), recompone y VERIFICA.
  const seeded = await synthesize(examples, { extraPrims: [prim] });
  console.log(`3. síntesis + sembrado  → ${seeded.ok ? seeded.recipe : seeded.reason}  (verificado contra TODOS los ejemplos)`);

  if (seeded.ok) {
    console.log("\nCódigo emitido (autónomo, $0, determinista):\n");
    console.log(seeded.code);
    // 4) Cristalizar: si quieres reutilizar la capacidad, guarda la primitiva (o aprende una abstracción con learn()).
    //    A partir de aquí toda tarea base64-flavored se resuelve recomponiendo, sin volver a llamar al LLM.
  }
})();
