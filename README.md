# Synthcore

**Inductive program synthesis with library learning, for JS/TS. No LLM, no GPU.**

Give it input→output examples and `synthcore` returns a **verified function** (or `{ok:false}`). It never
hallucinates: it only returns a program that passes **all** your examples. Zero marginal cost, deterministic,
auditable, offline.

```ts
import { synthesize } from "synthcore";

const r = await synthesize([
  { input: '{"email":"a@b.com"}', output: "a@b.com" },
  { input: '{"email":"c@d.com"}', output: "c@d.com" },
  { input: '{"email":"e@f.com"}', output: "e@f.com" },
]);

if (r.ok) {
  console.log(r.recipe); // "get(parseJSON(arg0),\"email\")"  ← real recipe, verified
  console.log(r.code);   // a standalone `solve` function that passes the 3 examples
}
```

`r` is `{ ok:true, code, recipe, size, entry, ast }` or `{ ok:false, reason }`. `code` is a standalone JS function
ready to run; `recipe` is its readable form; `ast` is the recipe as a tree (consumed by `learn()`); `reason` ∈
`"bad_input" | "not_found" | "unverified"`.

## What it solves / what it doesn't

Enumerative search over a bounded DSL: it shines at **small, composable transformations** over numbers, strings,
arrays and JSON. It is not general-purpose code generation.

| ✅ Solves today (verified in demo/tests) | ❌ Out of scope today |
|---|---|
| Scalar arithmetic — `double` → `add(arg0,arg0)` | Large programs / application logic (it won't write an app) |
| Strings — `reverse` → `rev(arg0)`, `UPPERCASE` → `upper(arg0)` | Filtering / dedup: the `filter`/`unique` combinators are missing |
| JSON parsing — `JSON field` → `get(parseJSON(arg0),"email")` | Arbitrary recursion (e.g. Fibonacci) / deep structures |
| List reduction — `sum` → `sum(arg0)`, `average` → `idiv(sum(arg0),len(arg0))` | Algorithms with deep recursion or backtracking |
| Lists — `sort` → `sort(arg0)`, `max` → `max(arg0)`, `map`/`zipWith` | Transformations depending on external state or I/O |
| Dates/numbers/regex via the **opt-in** `std` bundle — `year` → `year(arg0)`, `"$1,234.50"` → `num(arg0)` | Large multi-step programs (enumerative budget) |

For the right column, the path is to **seed a primitive** (`extraPrims`, e.g. proposed by an LLM) or raise the
search budget — it's not a wall, it's a frontier that moves.

## How it works

- **Typed bottom-up search** over a DSL of combinators (n-ary application, `map`, `fold`, `zipWith`, constants),
  with **observational-equivalence pruning** (dedup by the output vector) → the exponential pruning that makes it
  tractable.
- **Deterministic verification** in a **hardened** subprocess (no `env`, memory cap, temporary `cwd`, hard kill on
  timeout). Only code that passes **all** examples is returned.
- **Library learning** (wake/sleep, DreamCoder/LILO style): mines recurring sub-programs, generalizes them into
  **abstractions** ranked by compression (MDL) and reuses them → solves deeper with the same budget.
- **Optional LLM hybrid**: when pure synthesis fails, an LLM can propose **one new primitive** (`extraPrims`); the
  engine verifies it and, if it unlocks the solution, recomposes it for free forever. The LLM introduces the rare,
  expensive bit; the engine recomposes deterministically and at $0.

## API

```ts
synthesize(examples, opts?) → Promise<{ ok:true, code, recipe, size, entry, ast } | { ok:false, reason }>
```

- `examples`: a list of `{ input, output }` | `{ in, out }` | `{ args:[...], expect }`. An array `input` is **one**
  list argument (not varargs). At least **3–5** examples recommended.
- `opts`: `{ entry?, tools?, rounds?, maxEvals?, extraPrims?, std?, verify? }`.

### Rich types (opt-in): dates, numbers in text, regex

The standard primitives are not in the base DSL — they enlarge the search and raise the overfitting risk — so they
are enabled with `{ std: true }` (or by passing `extraPrims: stdPrims`):

```ts
await synthesize([{ input: "2024-03-15", output: 2024 }, /* … */], { std: true });  // → year(arg0)
await synthesize([{ input: "$1,234.50", output: 1234.5 }, /* … */], { std: true });  // → num(arg0)
```

`stdPrims` = `datePrims` (`year`/`month`/`day`/`weekday`, in UTC) + `numberPrims` (`num`/`digits`) + `regexPrims`
(`regexExtract`/`regexMatch`).

### Science domain bundles (opt-in): physics & chemistry laws

Physical and chemical laws ship as injectable primitives (`physicsPrims`, `chemPrims`, or both via `sciencePrims`).
Give it data and it recovers the **exact** law — verified symbolic regression, like PySR/Eureqa but with an exact
guarantee instead of a minimized error:

```ts
import { synthesize, physicsPrims, chemPrims } from "synthcore";

await synthesize([{ args: [2, 3], expect: 9 }, { args: [4, 5], expect: 50 }, /* … */],
  { extraPrims: physicsPrims });                      // → kinetic(arg0,arg1)   (½·m·v²)

await synthesize([{ input: 0.01, output: 2 }, { input: 0.001, output: 3 }, /* … */],
  { extraPrims: chemPrims });                          // → pH(arg0)             (-log₁₀[H⁺])
```

Honest frontier: for **noisy** experimental data use PySR (it minimizes error); for **exact** transformations
(discrete laws, unit conversions, identities) Synthcore wins (exact verification). Note the engine only **composes**
arity-1/2 primitives in its rounds, so arity-3 laws (e.g. `idealGasP` = `nRT/V`) only synthesize when the task itself
has that arity.

### Multi-language output: transpile to Python

The engine synthesizes a language-independent AST (`Recipe`); `synthesize` lowers it to JS, and `emitPython` lowers
the same verified AST to standalone Python — no extra search, just an output pass:

```ts
import { synthesize, emitPython } from "synthcore";

const r = await synthesize([{ input: [1, 2, 3], output: 6 }, { input: [10, 20], output: 30 }]);
if (r.ok) emitPython(r.ast);   // → "def solve(*a):\n    return sum(a[0])"
```

Pass the same `tools`/`extraPrims`/`std` you gave `synthesize`. Only the base DSL and the bundles we maintain
(`std`, domain) transpile; a learned abstraction or an arbitrary injected `extraPrim` (raw JS) throws a clear error
instead of emitting incorrect code.

### Learn a library that grows with use

`learn()` mines reusable abstractions from solutions you already found (DreamCoder/LILO, MDL ranking). Pass them back
as `tools` and the engine solves deeper with the same budget. `serializeLibrary` / `loadLibrary` persist them across
sessions (plain JSON):

```ts
const r1 = await synthesize(examplesA);
const r2 = await synthesize(examplesB);
const lib = await learn([r1, r2]);                  // mine verified abstractions
const r3 = await synthesize(examplesC, { tools: lib.tools }); // reuse what was learned

const json = serializeLibrary(lib.tools);           // persist
const tools = loadLibrary(json);                     // restore in another session
```

### LLM-seeder hybrid

When pure synthesis fails, an LLM proposes **one** primitive (`extraPrims`); the engine verifies it and recomposes
it for free. Full copy-paste example: [`examples/hybrid-llm-seeding.ts`](examples/hybrid-llm-seeding.ts).

**Advanced surface** (composition, independent verification): `solveBySynthesis`, `learnAbstractions`, `grade`
(verifier), `buildOps`, `configureSearch`, and the types `Tool` / `Recipe` / `Op` / `Abstraction`.

## Limitations (read them — honest selling avoids the hype that burns)

- **It is not general code generation.** Enumerative search only reaches **small** programs in a bounded DSL; it does
  not write an application nor reason over natural-language specs.
- **It complements an LLM, it doesn't replace it.** The model is the hybrid (LLM proposes rare primitives; Synthcore
  recomposes them for free and verified), not a head-on competitor.
- **With few examples it can overfit.** It returns *some* program that passes what you gave it; with 1–2 examples that
  may be a coincidence. Real case: for "email domain" with 3 examples the engine finds
  `max(split(capitalize(arg0),"@"))` — it passes by accident (the domain wins the lexicographic order), not because it
  "understands" emails. Give **≥3–5** examples with edge cases so the solution truly generalizes.
- **Bounded DSL.** Dates, regex, numbers-in-text and the science bundles (physics/chemistry) exist but are **opt-in**
  (`{ std: true }` or `extraPrims`), because each primitive enlarges the search. The `filter`/`unique` combinators are
  still missing and there is no recursion, so filtering, dedup or Fibonacci return `not_found`. It's the current DSL
  frontier (it moves by seeding primitives), not a hidden case.
- **Transpilation is template-based, not a full compiler.** `emitPython` covers the base DSL and the bundles we
  maintain. Learned abstractions and arbitrary injected primitives (raw JS) are not transpiled — it throws rather than
  emit code it can't guarantee.
- **Niche, not mass.** The audience is developers/tooling, not end consumers.

## Positioning

- **vs Microsoft PROSE / FlashFill** (mature PBE): Synthcore adds **library learning + deep composition**, and is
  **embeddable, open TS** (PROSE is C#/closed and string/table-centric).
- **vs DreamCoder / LILO** (academic, Python + GPU): Synthcore is a TS project that **runs on a laptop without a GPU**.
- **vs LLM codegen** (Copilot/Cursor): **deterministic, verified, $0, offline, auditable** — the other half of the stack.

## Usage

```bash
npm install synthcore   # in your project
```

Repo development:

```bash
npm install        # devDeps only (typescript, tsx, @types/node)
npm run demo       # solves 8/8 example tasks, verified, $0
npm run bench      # honest benchmark: 13/15 tasks, ~150 ms per solved task, $0
npm test           # contract suite (node:test)
npm run typecheck  # tsc --noEmit
npm run build      # compiles the library to dist/ (JS + types) for publishing
```

Requires Node ≥ 22. Pure ESM, no runtime dependencies.

## License

[MIT](LICENSE).
