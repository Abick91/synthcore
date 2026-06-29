// Smoke test del handler (sin levantar stdio): prueba la lógica que expone la herramienta MCP. Verifica que la
// síntesis funciona, que los bundles opt-in y la transpilación a Python responden, y que un caso imposible da no_found.
import { runSynthesize } from "./tool.js";

let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  if (!cond) fail++;
};

const r1 = await runSynthesize({ examples: [{ input: "abc", output: "cba" }, { input: "hi", output: "ih" }, { input: "xy", output: "yx" }] });
check("string reverse → js", r1.ok && r1.recipe === "rev(arg0)", r1.ok ? r1.recipe : (r1 as any).reason);

const r2 = await runSynthesize({ examples: [{ input: [1, 2, 3], output: 6 }, { input: [10, 20], output: 30 }], language: "python" });
check("sum → python transpile", r2.ok && r2.language === "python" && r2.code.includes("def solve"), r2.ok ? r2.code.replace(/\n/g, " ") : (r2 as any).reason);

const r3 = await runSynthesize({ examples: [{ input: "2024-03-15", output: 2024 }, { input: "1999-12-31", output: 1999 }, { input: "2010-01-01", output: 2010 }], bundle: "std" });
check("date year → bundle std", r3.ok && r3.recipe === "year(arg0)", r3.ok ? r3.recipe : (r3 as any).reason);

const r4 = await runSynthesize({ examples: [{ input: 1, output: "cat" }, { input: 2, output: "dog" }, { input: 3, output: "fish" }] });
check("impossible → not_found", !r4.ok && r4.reason === "not_found", r4.ok ? "(resolved?!)" : r4.reason);

console.log(fail === 0 ? "\nALL GOOD" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
