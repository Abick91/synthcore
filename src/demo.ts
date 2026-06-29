// Demo del motor. Cada caso da 3 ejemplos I/O y synthcore devuelve una función verificada — sin LLM, sin GPU.
// Corre con `npm run demo`.
import { synthesize, type Example } from "./index.js";

// Cada caso da 3 ejemplos I/O y synthcore devuelve una receta VERIFICADA que generaliza. Cobertura honesta:
// números, strings, parseo de JSON y operaciones sobre listas (todas las recetas son canónicas, no coincidencias).
const SUITE: { name: string; examples: Example[] }[] = [
  { name: "doblar número", examples: [{ input: 2, output: 4 }, { input: 3, output: 6 }, { input: 5, output: 10 }] },
  { name: "invertir string", examples: [{ input: "abc", output: "cba" }, { input: "hello", output: "olleh" }, { input: "xy", output: "yx" }] },
  { name: "MAYÚSCULAS", examples: [{ input: "abc", output: "ABC" }, { input: "hi", output: "HI" }, { input: "xy", output: "XY" }] },
  { name: "extraer campo JSON", examples: [{ input: '{"email":"a@b.com"}', output: "a@b.com" }, { input: '{"email":"c@d.com"}', output: "c@d.com" }] },
  { name: "suma de lista", examples: [{ input: [1, 2, 3], output: 6 }, { input: [10, 20], output: 30 }, { input: [5], output: 5 }] },
  { name: "ordenar lista", examples: [{ input: [3, 1, 2], output: [1, 2, 3] }, { input: [5, 4], output: [4, 5] }, { input: [2, 1, 3], output: [1, 2, 3] }] },
  { name: "promedio de lista", examples: [{ input: [2, 4], output: 3 }, { input: [1, 2, 3], output: 2 }, { input: [10, 20, 30], output: 20 }] },
  { name: "máximo de lista", examples: [{ input: [3, 1, 2], output: 3 }, { input: [5, 9, 2], output: 9 }, { input: [1, 4, 2], output: 4 }] },
];

(async () => {
  console.log("synthcore — síntesis inductiva verificada (sin LLM, $0)\n");
  let ok = 0;
  for (const t of SUITE) {
    const r = await synthesize(t.examples, { maxEvals: 500_000 });
    if (r.ok) { ok++; console.log(`  ✅ ${t.name.padEnd(22)} → ${r.recipe}`); }
    else console.log(`  ❌ ${t.name.padEnd(22)} → ${r.reason}`);
  }
  console.log(`\n${ok}/${SUITE.length} resueltas, verificadas, coste $0.`);
})();
