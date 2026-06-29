// BENCHMARK HONESTO (v1.0). Mide lo que synthcore PUEDE medir por sí mismo: tasa de resolución y tiempo de pared
// por tarea, todo determinista, offline y a coste $0. NO es un "synthcore vs LLM": una comparación así necesitaría
// un LLM (coste, red, no determinismo) y queda fuera de una librería pura — la dejamos como nota de posición en el
// README, no como número inventado aquí. La suite incluye a propósito tareas que FALLAN (not_found) para que el
// número refleje la frontera real del DSL, no una demo maquillada. Corre con `npm run bench`.
import { synthesize, type Example } from "./index.js";

type Task = { name: string; cat: string; examples: Example[]; std?: boolean };
const SUITE: Task[] = [
  // números
  { name: "doblar", cat: "número", examples: [{ input: 2, output: 4 }, { input: 3, output: 6 }, { input: 5, output: 10 }] },
  { name: "incrementar", cat: "número", examples: [{ input: 2, output: 3 }, { input: 9, output: 10 }, { input: 0, output: 1 }] },
  { name: "cuádruple", cat: "número", examples: [{ input: 2, output: 8 }, { input: 3, output: 12 }, { input: 5, output: 20 }] },
  // strings
  { name: "invertir", cat: "string", examples: [{ input: "abc", output: "cba" }, { input: "hello", output: "olleh" }, { input: "xy", output: "yx" }] },
  { name: "MAYÚSCULAS", cat: "string", examples: [{ input: "abc", output: "ABC" }, { input: "hi", output: "HI" }, { input: "xy", output: "XY" }] },
  { name: "capitalizar", cat: "string", examples: [{ input: "bOB", output: "Bob" }, { input: "aLiCe", output: "Alice" }, { input: "x", output: "X" }] },
  // JSON / parseo
  { name: "campo JSON", cat: "json", examples: [{ input: '{"email":"a@b.com"}', output: "a@b.com" }, { input: '{"email":"c@d.com"}', output: "c@d.com" }] },
  // listas
  { name: "suma", cat: "lista", examples: [{ input: [1, 2, 3], output: 6 }, { input: [10, 20], output: 30 }, { input: [5], output: 5 }] },
  { name: "ordenar", cat: "lista", examples: [{ input: [3, 1, 2], output: [1, 2, 3] }, { input: [5, 4], output: [4, 5] }, { input: [2, 1, 3], output: [1, 2, 3] }] },
  { name: "promedio", cat: "lista", examples: [{ input: [2, 4], output: 3 }, { input: [1, 2, 3], output: 2 }, { input: [10, 20, 30], output: 20 }] },
  { name: "máximo", cat: "lista", examples: [{ input: [3, 1, 2], output: 3 }, { input: [5, 9, 2], output: 9 }, { input: [1, 4, 2], output: 4 }] },
  // tipos ricos (opt-in std)
  { name: "año de fecha", cat: "fecha", std: true, examples: [{ input: "2024-03-15", output: 2024 }, { input: "1999-12-31", output: 1999 }, { input: "2010-01-01", output: 2010 }] },
  { name: "precio→número", cat: "fecha", std: true, examples: [{ input: "$1,234.50", output: 1234.5 }, { input: "$10.00", output: 10 }, { input: "$3,000", output: 3000 }] },
  // frontera honesta: fuera del DSL (esperado not_found)
  { name: "filtrar pares", cat: "frontera", examples: [{ input: [1, 2, 3, 4], output: [2, 4] }, { input: [5, 6, 7, 8], output: [6, 8] }, { input: [2, 3], output: [2] }] },
  { name: "fibonacci", cat: "frontera", examples: [{ input: 5, output: 5 }, { input: 6, output: 8 }, { input: 7, output: 13 }] },
];

(async () => {
  console.log("synthcore — benchmark (determinista, offline, $0)\n");
  let solved = 0;
  let totalMs = 0;
  const rows: string[] = [];
  for (const t of SUITE) {
    const t0 = performance.now();
    const r = await synthesize(t.examples, { std: t.std });
    const ms = performance.now() - t0;
    totalMs += ms;
    if (r.ok) solved++;
    const mark = r.ok ? "✅" : "··";
    const detail = r.ok ? r.recipe : r.reason;
    rows.push(`  ${mark} ${t.cat.padEnd(8)} ${t.name.padEnd(16)} ${ms.toFixed(0).padStart(5)} ms   ${detail}`);
  }
  console.log(rows.join("\n"));
  const pct = ((solved / SUITE.length) * 100).toFixed(0);
  console.log(`\n${solved}/${SUITE.length} resueltas (${pct}%)  ·  ${totalMs.toFixed(0)} ms total  ·  ${(totalMs / SUITE.length).toFixed(0)} ms/tarea  ·  $0`);
  console.log("Nota: las tareas 'frontera' fallan a propósito (filtrar/recursión están fuera del DSL actual).");
})();
