# synthcore-mcp

**An MCP server that gives any agent a deterministic, verified, $0 tool to synthesize small data-transform functions from examples.**

The LLM reasons; **Synthcore guarantees**. When an agent needs a small data transformation (parsing, field
extraction, normalization, list ops, recovering an exact formula), instead of *hallucinating* code it can call this
tool with input→output examples and get back a function that is **verified to pass all of them** — or an honest
`not_found`. No LLM, no GPU, no API key, offline, zero marginal cost.

It wraps [`synthcore`](https://github.com/Abick91/synthcore) and speaks the [Model Context
Protocol](https://modelcontextprotocol.io) over stdio.

## Tool

### `synthesize`

| Param | Type | Notes |
|---|---|---|
| `examples` | `{input,output}[]` \| `{in,out}[]` \| `{args,expect}[]` | 3-5 examples with edge cases. An array `input` is **one** list argument. |
| `bundle` | `"std" \| "physics" \| "chem" \| "science"` (optional) | Opt-in primitives (enlarge search): dates/numbers/regex, or physics/chemistry laws. |
| `language` | `"js" \| "python"` (optional) | Output language for `code` (default `js`). |

Returns `{ ok:true, recipe, code, language, size }` or `{ ok:false, reason }`.

## Run

```bash
npm install
npm run build        # → dist/server.js
# or, for development:
npm start            # tsx server.ts (stdio)
npm run smoke        # verify the handler logic
```

## Wire it into a client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "synthcore": {
      "command": "npx",
      "args": ["-y", "synthcore-mcp"]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` (same `command`/`args` shape).

For development you can point `command` at `npx` with `args: ["tsx", "/absolute/path/to/mcp/server.ts"]`.

## Example call

```jsonc
// tool: synthesize
{
  "examples": [
    { "input": "2024-03-15", "output": 2024 },
    { "input": "1999-12-31", "output": 1999 },
    { "input": "2010-01-01", "output": 2010 }
  ],
  "bundle": "std",
  "language": "python"
}
// → { "ok": true, "recipe": "year(arg0)", "language": "python",
//     "code": "...def solve(*a): ...", "size": 2 }
```

## License

[MIT](../LICENSE).
