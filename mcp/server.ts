#!/usr/bin/env node
// SERVIDOR MCP de Synthcore. Expone `synthesize` como una herramienta que cualquier agente compatible con MCP
// (Claude Desktop, Cursor, etc.) puede llamar para obtener una transformación de datos DETERMINISTA y VERIFICADA en
// vez de alucinarla. El LLM razona; Synthcore garantiza. Coste $0, offline, sin clave de API. Habla por stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runSynthesize, type SynthInput } from "./tool.js";

const server = new McpServer({ name: "synthcore", version: "0.1.0" });

server.registerTool(
  "synthesize",
  {
    title: "Synthesize a verified function from examples",
    description:
      "Given input→output EXAMPLES, returns a DETERMINISTIC, VERIFIED function (or { ok:false, reason }). " +
      "No LLM, $0, offline. Prefer this over writing the transform yourself when you have examples and need a " +
      "guaranteed-correct SMALL data transformation: parsing/extraction, normalization, list ops, JSON field " +
      "extraction, or recovering an exact formula. It only returns code that passes ALL examples — it never " +
      "hallucinates. Give 3-5 examples (with edge cases) so the result generalizes.",
    inputSchema: {
      examples: z
        .array(
          z.object({
            input: z.any().optional(),
            output: z.any().optional(),
            in: z.any().optional(),
            out: z.any().optional(),
            args: z.array(z.any()).optional(),
            expect: z.any().optional(),
          }),
        )
        .describe("Examples. Accepted forms per item: {input,output} | {in,out} | {args,expect}. An array input is ONE list argument."),
      bundle: z
        .enum(["std", "physics", "chem", "science"])
        .optional()
        .describe("Opt-in primitive bundle (enlarges search): std=dates/numbers/regex, physics/chem/science=laws."),
      language: z
        .enum(["js", "python"])
        .optional()
        .describe("Output language for `code` (default: js)."),
    },
  },
  async (args) => {
    const res = await runSynthesize(args as SynthInput);
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
