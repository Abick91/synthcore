// AISLAMIENTO DEL SANDBOX. TODO código no confiable (sintetizado por el motor o generado por un LLM) se ejecuta en
// un subproceso Node ENDURECIDO. No es seccomp/contenedor (ese es el siguiente escalón), pero cierra las fugas
// REALES en una caja Node:
//   1. ENTORNO MÍNIMO — el hijo NO hereda `process.env` → el código graduado no puede leer secretos del proceso padre.
//   2. TOPE DE MEMORIA (`--max-old-space-size`) — un programa runaway/malicioso no puede tumbar la caja por OOM.
//      Configurable por `SYNTHCORE_SANDBOX_MEM_MB`.
//   3. CWD EN TEMP — escrituras de fichero relativas caen en el temp del SO, no en el repo.
//   4. KILL DURO por timeout (SIGKILL).
// Un único helper → endurecer una vez, aplicar en todos los harness del motor.
import { spawn } from "node:child_process";
import os from "node:os";

const MEM_MB = Number(process.env.SYNTHCORE_SANDBOX_MEM_MB || 512);
const BASE_FLAGS = [`--max-old-space-size=${MEM_MB}`, "--input-type=module"];
// Bloquea eval()/new Function()/setTimeout(string) EN RUNTIME → cierra escapes basados en generación dinámica de
// código. Solo para harness INTERNOS del motor (synth/abstract: componen funciones en el source, nunca evalúan
// strings). El grader (krites) gradúa código que SÍ podría usar Function legítimamente → ahí NO.
const NO_CODEGEN = "--disallow-code-generation-from-strings";
// PATH y SystemRoot mínimos por si el SO los necesita para arrancar el binario; nada de secretos de la app.
const SAFE_ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH || "", SystemRoot: process.env.SystemRoot || "" };
const TMP = os.tmpdir();

/** Ejecuta `source` (módulo ES por STDIN) en el subproceso endurecido. `captureErr` recoge stderr (para el grader,
 *  que reporta el error del candidato). Devuelve siempre — nunca lanza; el timeout mata el hijo y resuelve. */
export function runSandboxed(source: string, timeoutMs: number, captureErr = false, allowCodegen = false): Promise<{ out: string; err: string }> {
  const flags = allowCodegen ? BASE_FLAGS : [NO_CODEGEN, ...BASE_FLAGS];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, flags, {
      stdio: ["pipe", "pipe", captureErr ? "pipe" : "ignore"], env: SAFE_ENV, cwd: TMP,
    });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    if (captureErr) child.stderr?.on("data", (d) => (err += d));
    child.on("close", () => { clearTimeout(timer); resolve({ out, err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ out, err: String(e) }); });
    child.stdin?.on("error", () => { /* EPIPE si el hijo muere antes de leer */ });
    child.stdin?.write(source); child.stdin?.end();
  });
}

/** Igual de endurecido (sin env, cwd temp, kill duro) pero para un intérprete ARBITRARIO (python, binario Rust…)
 *  leyendo el programa por STDIN. Devuelve la última línea de stdout. Para runners multi-lenguaje. */
export function runHardenedCmd(cmd: string, args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"], env: SAFE_ENV, cwd: TMP });
    let out = ""; const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.on("close", () => { clearTimeout(timer); resolve(out.trim().split(/\r?\n/).pop() || ""); });
    child.on("error", () => { clearTimeout(timer); resolve(""); });
    child.stdin?.on("error", () => { /* el hijo pudo morir antes de leer */ });
    child.stdin?.end(stdin);
  });
}
