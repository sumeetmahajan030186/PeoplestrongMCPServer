/* --------------------------------------------------------------------
   Thursday‑Demo MCP Server
   npm i express undici zod @modelcontextprotocol/sdk openai dotenv
--------------------------------------------------------------------- */

import express from "express";
import { Agent } from "undici";
import { fetch } from "undici";
import { z } from "zod";
import "dotenv/config";                      // loads OPENAI_API_KEY

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { SSEServerTransport, TransportWriteOptions }
        from "@modelcontextprotocol/sdk/server/sse";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: "" });

/* ---------- 1. MCP instance --------------------------------------- */
const mcp = new McpServer({ name: "Thursday Demo", version: "1.0.0" });

/* ---------- 2. Shared helper -------------------------------------- */
async function runChatLLM(prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful HR assistant." },
      { role: "user",   content: prompt }
    ]
  });
  return completion.choices[0].message?.content ?? "(no answer)";
}

/* ---------- 0. helper that calls openai with tool support ---------- */
async function runWithTools(prompt: string): Promise<string> {
  /* ① tell the model what tools exist */
  const tools = [
    {
      type: "function",
      function: {
        name: "getWeather",
        description: "Get current weather for a city (°C, description)",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name, e.g. 'Delhi'" }
          },
          required: ["city"]
        }
      }
    }
  ];

  /* ② first request – let the model either answer or pick a tool */
  const first = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    tool_choice: "auto",
    tools,
    messages: [
      { role: "system", content: "You are a helpful HR assistant." },
      { role: "user",   content: prompt }
    ]
  });

  const msg = first.choices[0].message!;

  /* ③ did the model ask to call a tool? */
  if (msg.tool_calls && msg.tool_calls.length) {
    const call = msg.tool_calls[0];
    if (call.function.name === "getWeather") {
      const { city } = JSON.parse(call.function.arguments) as { city: string };

      /* run your real tool handler */
      const toolResult = await fetchWeather(city);

      /* ④ give the tool result back to the model for the final reply */
      const second = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system",  content: "You are a helpful HR assistant." },
          { role: "user",    content: prompt },
          msg,                                           // the tool‑call
          {
            role: "tool",
            name: "getWeather",
            tool_call_id: call.id,
            content: toolResult                          // result string
          }
        ]
      });
      return second.choices[0].message!.content ?? "(no answer)";
    }
  }

  /* ⑤ no tool needed – just return the model’s text */
  return msg.content ?? "(no answer)";
}

/* ---------------- helper: write one chunk -------------------------------- */
function writeFrame(
  t: SSEServerTransport,
  data: Record<string, unknown>,
  opts?: TransportWriteOptions
) {
  const last   = opts?.last ?? false;
  const payload = { ...data, done: last };

  // `send()` streams an SSE “message” event that your Streamlit front‑end parses
  t.send(payload as any);        // cast loosens the JSON‑RPC typing
  if (last) t.close();           // tidy up when we're done
}

/* ---------- 3. Tools ---------------------------------------------- */

// a) weather
const insecure = new Agent({ connect: { rejectUnauthorized: false } });
/* ---------- weather helper ---------------------------------------- */
async function fetchWeather(city: string): Promise<string> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const res = await fetch(url, { dispatcher: insecure as any });
  if (!res.ok) throw new Error(`wttr responded ${res.status}`);

  const { current_condition: [cur] } = await res.json() as any;
  return `Weather in ${city}: ${cur.temp_C} °C, ${cur.weatherDesc[0].value}`;
}

// c) chat LLM
mcp.tool(
  "chatLLM",
  { prompt: z.string() },
  async ({ prompt }) => ({
    content: [{ type: "text", text: await runChatLLM(prompt) }]
  })
);

mcp.tool(
  "getWeather",
  { city: z.string() },
  async ({ city }) => ({
    content: [{ type: "text", text: await fetchWeather(city) }]
  })
);
/* ---------- 4. HTTP layer ----------------------------------------- */
const app = express();
app.use(express.json());

const streams = new Map<string, SSEServerTransport>();

/* --- GET /sse ------------------------------------------------------ */
app.get("/sse", (req, res) => {
  const id = String(req.query.id || "");
  if (!id) return res.status(400).send("session id required");

  res.setHeader("Access-Control-Allow-Origin", "http://localhost:8501");
  res.setHeader("Cache-Control", "no-cache");

  const t = new SSEServerTransport("/messages", res);
  streams.set(id, t);
  mcp.connect(t);

  res.on("close", () => streams.delete(id));
});

/* --- POST /messages ------------------------------------------------ */
app.post("/messages", async (req, res) => {
  const id  = String(req.body.id || "");
  const t   = streams.get(id);
  const msg = String(req.body.content || "");

  if (!id) return res.status(400).send("session id required");
  if (!t)  return res.status(202).end();               // SSE not open yet

  // 1️⃣ let MCP try (handles explicit tool calls)
  let sawAssistantTokens = false;
  await t.handlePostMessage(req, res, req.body, {
    onAssistantToken(token, { last }) {
      sawAssistantTokens = true;
      writeFrame(t, { role: "assistant", content: token }, { last });
    }
  });

  // 2️⃣ fallback: route plain text to chatLLM
  if (!sawAssistantTokens && msg.trim()) {
    const answer = await runWithTools(msg);
    writeFrame(t, { role: "assistant", content: answer }, { last: true });
  }
});

/* ---------- 5. Start server --------------------------------------- */
app.listen(3000, () =>
   console.log("✅ MCP up – SSE stream at http://localhost:3000/sse?id=<uuid>")
);
