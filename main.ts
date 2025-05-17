/* --------------------------------------------------------------------
   Thursday‑Demo MCP Server
   npm i express undici zod @modelcontextprotocol/sdk openai dotenv
--------------------------------------------------------------------- */

import express from "express";
import { Agent, fetch } from "undici";
import { z } from "zod";
import "dotenv/config";                      // loads OPENAI_API_KEY

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { SSEServerTransport, TransportWriteOptions } from "@modelcontextprotocol/sdk/server/sse";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: "" });

/* ---------- 1. MCP instance --------------------------------------- */
const mcp = new McpServer({ name: "AI Employee Agent Demo", version: "1.0.0" });

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

async function fetchPSToken(
  args: { client_id: string; client_secret: string },
  timeoutMs = 8_000               // shorten/extend as you wish
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("Request timed out"));
  }, timeoutMs);

  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: args.client_id,
      client_secret: args.client_secret
    });

    const res = await fetch(
      "https://uat-auth.peoplestrong.com/auth/realms/3/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`PeopleStrong responded ${res.status}: ${txt}`);
    }

    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error("No access_token field in response");
    }
    return json.access_token;
  } catch (err) {
    // Re‑throw with a consistent prefix so callers can recognise it
    throw new Error(`fetchPSToken failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
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
    },
    {
      type: "function",
      function: {
        name: "getPSToken",
        description:
          "Obtain an OAuth2 access‑token from PeopleStrong. Requires client_id and client_secret.",
        parameters: {
          type: "object",
          properties: {
            client_id:     { type: "string", description: "PeopleStrong client_id" },
            client_secret: { type: "string", description: "PeopleStrong client_secret" }
          },
          required: ["client_id", "client_secret"]
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
    }else if (call.function.name === "getPSToken") {
      const { client_id, client_secret } = JSON.parse(
        call.function.arguments
      ) as { client_id: string; client_secret: string };

      /* run the real tool handler  */
      let toolResult: string;
      try {
        toolResult = await fetchPSToken({ client_id, client_secret });
      } catch (err) {
        toolResult = `❌  Error fetching token – ${(err as Error).message}`;
      }

      /* ④ give the tool result back to the model for the final reply */
      const second = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful HR assistant." },
          { role: "user",   content: prompt },
          msg,                                           // the tool‑call
          {
            role: "tool",
            name: "getPSToken",
            tool_call_id: call.id,
            content: toolResult                          // token or error text
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

mcp.tool(
  "getPSToken",
  {
    client_id:     z.string(),
    client_secret: z.string()
  },
  async ({ client_id, client_secret }) => ({
    content: [
      {
        type: "text",
        text: await fetchPSToken({ client_id, client_secret })
      }
    ]
  })
);
/* ---------- 4. HTTP layer ----------------------------------------- */
const app = express();
app.use(express.json());

const streams = new Map<string, SSEServerTransport>();

// Root path – Inspector defaults to this when Connect path is empty
app.get("/", async (_req, res) => {
  const t = new SSEServerTransport("/messages", res);
  const sessionId = t.sessionId;

  try {
    await mcp.connect(t);                // handshake (capabilities) sent
    streams.set(sessionId, t);           // map by canonical ID
  } catch (err) {
    console.error("handshake failed", err);
    return;
  }

  res.on("close", () => streams.delete(sessionId));
});


/* --- GET /sse ------------------------------------------------------ */
app.get("/sse", (req, res) => {
  const id = String(req.query.id || "");
  if (!id) return res.status(400).send("session id required");

  res.setHeader("Cache-Control", "no-cache");

  const t = new SSEServerTransport("/messages", res);
  streams.set(id, t);
  mcp.connect(t);

  res.on("close", () => streams.delete(id));
});

/* --- POST /messages ------------------------------------------------ */
app.post("/messages", async (req, res) => {
  const id = String(
    req.query.sessionId ??      // Inspector default
    req.query.id ??             // legacy /sse?id=...
    req.body.sessionId ??       // alt. client style
    req.body.id ??              // your original code
    ""
  );
  const t   = streams.get(id);
  const msg = String(req.body.content || "");
  if (!t) return res.status(202).end();

  let sawResponse = false;               // response of any kind?
  console.log("⬅️  incoming /messages =",JSON.stringify(req.body, null, 2));
  await t.handlePostMessage(req, res, req.body, {
    // 1) token‑streaming (rare unless you asked the model to stream)
    onAssistantToken(token, { last }) {
      sawResponse = true;
      console.log("streamed assistant token");
      writeFrame(t, { role: "assistant", content: token }, { last });
    },
  
    // 2) one‑shot assistant replies (LLM text, no streaming)
    onAssistantMessage(message) {
      sawResponse = true;
      console.log("assistant message →", message.content);
      writeFrame(t, message, { last: true });
    },
  
    // 3) tool results (getWeather, getPSToken, …)
    onToolResult(message) {
      sawResponse = true;
      console.log(`Handled with MCP tool → ${message.name}`);
      writeFrame(t, message, { last: true });
    }
  });

  /* fallback only if MCP produced nothing at all */
  if (!sawResponse && msg.trim()) {
    console.log("runWithTools fallback");
    const answer = await runWithTools(msg);
    writeFrame(t, { role: "assistant", content: answer }, { last: true });
  }
});

const PORT = process.env.PORT || 3000;
/* ---------- 5. Start server --------------------------------------- */
app.listen(PORT, '0.0.0.0', () => console.log("MCP server running"));
