// Reads the tool surface back out of a real browser and holds it to the WebMCP
// budgets for names and descriptions, which are the kind of rule-based limits
// worth checking in code rather than by eye.
import { chromium } from "playwright";

const BASE = process.env.ARENA_BASE || "http://localhost:3000";

const LIMITS = { name: 30, description: 500, paramDescription: 150 };
// Spec charset for tool names: 1-128 chars, ASCII alphanumeric plus _ - .
const NAME_CHARS = /^[A-Za-z0-9_.-]{1,128}$/;

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });

const tools = await page.evaluate(async () => {
  const model = document.modelContext ?? navigator.modelContext;
  if (!model) return null;
  const list = await model.getTools();
  return list.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    annotations: t.annotations,
    inputSchema: typeof t.inputSchema === "string" ? JSON.parse(t.inputSchema) : t.inputSchema,
  }));
});
await browser.close();

if (!tools) {
  console.log("FAIL no modelContext on the page");
  process.exit(1);
}

console.log(`${tools.length} tools registered\n`);

const seen = new Set();
for (const t of tools) {
  if (seen.has(t.name)) fail(`${t.name}: registered twice`);
  seen.add(t.name);

  if (!NAME_CHARS.test(t.name)) fail(`${t.name}: name uses characters the spec does not allow`);
  if (t.name.length > LIMITS.name) fail(`${t.name}: name is ${t.name.length} chars, over ${LIMITS.name}`);
  if (!t.title) fail(`${t.name}: no title, so it has no readable label in the browser's tool list`);
  if (!t.description) fail(`${t.name}: no description`);
  if (t.description && t.description.length > LIMITS.description) {
    fail(`${t.name}: description is ${t.description.length} chars, over ${LIMITS.description}`);
  }
  // Describe rather than forbid: a negative instruction
  // spends context telling the agent what not to do.
  if (/\b(do not|don't|never use)\b/i.test(t.description || "")) {
    fail(`${t.name}: description tells the agent what not to do rather than what it does`);
  }
  if (!t.annotations || typeof t.annotations.readOnlyHint !== "boolean") {
    fail(`${t.name}: no readOnlyHint, so an agent cannot tell whether calling it is safe`);
  }

  const props = t.inputSchema?.properties ?? {};
  for (const [param, schema] of Object.entries(props)) {
    if (param.length > LIMITS.name) fail(`${t.name}.${param}: parameter name over ${LIMITS.name} chars`);
    if (!schema.description) fail(`${t.name}.${param}: no description, so the agent has to guess`);
    else if (schema.description.length > LIMITS.paramDescription) {
      fail(`${t.name}.${param}: description is ${schema.description.length} chars, over ${LIMITS.paramDescription}`);
    }
    if (!schema.type && !schema.enum && !schema.anyOf) {
      fail(`${t.name}.${param}: no declared type`);
    }
  }
}

for (const t of tools) {
  const ro = t.annotations?.readOnlyHint ? "reads " : "writes";
  console.log(`  ${ro}  ${t.name.padEnd(22)} ${t.title ?? "(no title)"}`);
}

console.log(failures ? `\n${failures} failed` : "\nevery tool is within the published budgets");
process.exit(failures ? 1 : 0);
