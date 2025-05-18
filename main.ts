/* --------------------------------------------------------------------
   Thursday‑Demo MCP Server
   npm i express undici zod @modelcontextprotocol/sdk openai dotenv
--------------------------------------------------------------------- */

// Load environment variables from .env in project root
import "dotenv/config";

import express from "express";
import jwt from "jsonwebtoken";
import { Agent, fetch } from "undici";
import { z } from "zod";

import OpenAI from "openai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";

// Import all helper functions
import {
  getWeather,
  fetchPSToken,
  getPSTokenWithApiKey,
  normalizeFieldCode,
  getEmployeeDetails,
  getEmployeeBankDocumentDetails,
  getEmployeeConfirmationDocumentDetails,
  getEmployeeExitDocumentDetails,
  getEmployeePromotionDocumentDetails,
  getCandidateDetails
} from "./tools";

// Initialize OpenAI client (expects OPENAI_API_KEY in .env)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ---------- 1. MCP instance --------------------------------------- */
const mcp = new McpServer({ name: "AI Employee Agent Demo", version: "1.1.0" });

/* ---------- 2. Shared helper -------------------------------------- */
async function runChatLLM(prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful HR assistant." },
      { role: "user", content: prompt }
    ]
  });
  return completion.choices[0].message?.content ?? "(no answer)";
}

/* ---------- 3. Register MCP tools -------------------------------- */
// Chat completions
mcp.tool(
  "chatLLM",
  { prompt: z.string() },
  async ({ prompt }) => ({ content: [{ type: "text", text: await runChatLLM(prompt) }] })
);

// Weather lookup
mcp.tool(
  "getWeather",
  { city: z.string() },
  async ({ city }) => ({ content: [{ type: "text", text: await getWeather(city) }] })
);

// PeopleStrong OAuth token (CLIENT_ID/SECRET from args or env)
mcp.tool(
  "getPSToken",
  { client_id: z.string().optional(), client_secret: z.string().optional() },
  async ({ client_id, client_secret }) => {
    const id = client_id ?? process.env.PS_CLIENT_ID!;
    const secret = client_secret ?? process.env.PS_CLIENT_SECRET!;
    const token = await fetchPSToken({ client_id: id, client_secret: secret });
    return { content: [{ type: "text", text: token }] };
  }
);

// HR data tools schemas
const hrSchemas = {
  dynamicFilter: z.array(
    z.object({ fieldCode: z.string(), operator: z.string(), value: z.string() })
  ).optional(),
  startDate: z
    .object({ value: z.string(), field: z.array(z.object({ fieldCode: z.string(), operator: z.string() })) })
    .optional(),
  endDate: z
    .object({ value: z.string(), field: z.array(z.object({ fieldCode: z.string(), operator: z.string() })) })
    .optional()
};

// Employee master details
mcp.tool(
  "getEmployeeDetails",
  hrSchemas,
  async (args) => ({ content: [{ type: "json", json: await getEmployeeDetails(args) }] }),
    {
    title:       "Employee Data",
    description: "Retrieve employee records, optionally filtering by dynamicFilter and date range"
   }
);

// Document details (bank, confirmation, exit, promotion)
mcp.tool(
  "getEmployeeBankDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeBankDetails(args) }] }),
   {
    title:       "Employee Bank Data",
    description: "Retrieve employee bank records, and Filter by Employee Code"
   }
);

mcp.tool(
  "getEmployeeConfirmationDocumentDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeConfirmationDocumentDetails(args) }] }),
   {
    title:       "Employee Confirmation Data",
    description: "Retrieve employee Confirmation records, and Filter by Employee Code"
   }
);
);

mcp.tool(
  "getEmployeeExitDocumentDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeExitDocumentDetails(args) }] }),
  {
    title:       "Employee Exit Data",
    description: "Retrieve employee exit records,and Filter by Employee Code"
   }
  
);

mcp.tool(
  "getEmployeePromotionDocumentDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeePromotionDocumentDetails(args) }] }),
   {
    title:       "Employee Promotion Data",
    description: "Retrieve employee Promotion records, and Filter by Employee Code"
   }
);

mcp.tool(
  "getEmployeeIDDocumentDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeIDDocumentDetails(args) }] }),
   {
    title:       "Employee ID Data",
    description: "Retrieve employee ID records, and Filter by Employee Code"
   }
);

mcp.tool(
  "getEmployeeContactDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeContactDetails(args) }] }),
   {
    title:       "Employee Confirmation Data",
    description: "Retrieve employee Confirmation records, and Filter by Employee Code"
   }
);

mcp.tool(
  "getEmployeeDependentDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeDependentDetails(args) }] }),
   {
    title:       "Employee Dependent Data",
    description: "Retrieve employee Dependent records, and Filter by Employee Code"
   }
);

mcp.tool(
  "getEmployeeEmergencyContactDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeEmergencyContactDetails(args) }] }),
   {
    title:       "Employee EmergencyContact Data",
    description: "Retrieve employee EmergencyContact records, and Filter by Employee Code"
   }
);

mcp.tool(
  "getEmployeeNominationDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeNominationDetails(args) }] }),
   {
    title:       "Employee Nomination Data",
    description: "Retrieve employee Nomination records, and Filter by Employee Code"
   }
);
mcp.tool(
  "getEmployeeSkillDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeSkillDetails(args) }] }),
   {
    title:       "Employee Skill Data",
    description: "Retrieve employee Skill records, and Filter by Employee Code"
   }
);
mcp.tool(
  "getEmployeeTransferDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getEmployeeTransferDetails(args) }] }),
   {
    title:       "Employee Transfer Data",
    description: "Retrieve employee Transfer records, and Filter by Employee Code"
   }
);


// Candidate master details
mcp.tool(
  "getCandidateDetails",
  { dynamicFilter: hrSchemas.dynamicFilter },
  async (args) => ({ content: [{ type: "json", json: await getCandidateDetails(args) }] }),
   {
    title:       "Employee Candidate Data",
    description: "Retrieve employee Candidate records, and Filter by Employee Code"
   }
);

/* ---------- 4. HTTP layer ----------------------------------------- */
const app = express();
app.use(express.json());

// JWT auth middleware (replace jwks logic if needed)
const jwtKeyCallback = (
  _header: jwt.JwtHeader,
  _payload: jwt.JwtPayload,
  callback: (err: Error | null, secret?: jwt.Secret) => void
) => callback(null, process.env.JWT_SECRET!);

app.use((req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).send('Missing Authorization header');
  const token = authHeader.split(' ')[1];
  jwt.verify(
    token,
    jwtKeyCallback,
    { audience: 'claude-mcp', issuer: 'https://uat-auth.peoplestrong.com/auth/realms/3' },
    (err, decoded) => {
      if (err) return res.status(403).send('Invalid token');
      req.user = decoded;
      next();
    }
  );
});

// SSE connection streams
const streams = new Map<string, SSEServerTransport>();

app.get("/", (_req, res) => {
  const t = new SSEServerTransport("/messages", res);
  streams.set(t.sessionId, t);
  mcp.connect(t).catch(console.error);
  res.on("close", () => streams.delete(t.sessionId));
});

app.get("/sse", (req, res) => {
  const id = String(req.query.id || "");
  if (!id) return res.status(400).send("session id required");
  res.setHeader("Cache-Control", "no-cache");
  const t = new SSEServerTransport("/messages", res);
  streams.set(id, t);
  mcp.connect(t).catch(console.error);
  res.on("close", () => streams.delete(id));
});

app.post("/messages", async (req, res) => {
  const id = String(req.query.sessionId || req.query.id || req.body.sessionId || req.body.id || "");
  const t = streams.get(id);
  if (!t) return res.status(202).end();

  let saw = false;
  await t.handlePostMessage(req, res, req.body, {
    onAssistantToken(token, { last }) {
      saw = true;
      t.send({ role: "assistant", content: token, done: last });
    },
    onAssistantMessage(msg) {
      saw = true;
      t.send({ ...msg, done: true });
    },
    onToolResult(msg) {
      saw = true;
      t.send({ ...msg, done: true });
    }
  });

  if (!saw && String(req.body.content || '').trim()) {
    const reply = await runChatLLM(String(req.body.content));
    t.send({ role: "assistant", content: reply, done: true });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, '0.0.0.0', () => console.log(`MCP server running on port ${PORT}`));
