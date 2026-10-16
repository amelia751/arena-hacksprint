// A tool that writes must leave the person's page showing the result, with no reload.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const STORE = new URL("../.data/store.json", import.meta.url);

/** The probe authors real drafts; against a local store it takes them back out again. */
async function forget(ids) {
  try {
    const store = JSON.parse(await readFile(STORE, "utf8"));
    for (const id of ids) delete store.environments?.[id];
    await writeFile(STORE, JSON.stringify(store, null, 2));
  } catch {
    /* not running against a local store */
  }
}

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-experimental-web-platform-features",
    "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
  ],
});
const page = await browser.newPage();

const call = (name, args = {}) =>
  page.evaluate(
    async ([toolName, payload]) => {
      const ctx = document.modelContext;
      const tools = await ctx.getTools();
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) throw new Error(`no tool named ${toolName}`);
      return ctx.executeTool(tool, JSON.stringify(payload));
    },
    [name, args],
  );

// What the human can read off the page right now, without touching the browser.
// Deliberately not tied to a class name, so a restyle does not read as a regression.
const onScreen = () => page.locator("main").innerText();

const failures = [];
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures.push(label);
};

await page.goto(BASE, { waitUntil: "networkidle" });

const before = await onScreen();
console.log("before:", JSON.stringify(before));

const name = `Refresh Probe ${Date.now()}`;
const created = await call("create_environment", { name, players: 2 });
const id = created.match(/env_[0-9a-f]+/)?.[0];

const after = await onScreen();
console.log("after: ", JSON.stringify(after.replace(/\s+/g, " ").slice(0, 160)));
check("create_environment shows up with no reload", after.includes(name));

// The link is server-rendered, so the id being on screen is itself the proof.
const linked = await page.locator(`main a[href="/e/${id}"]`).count();
check("the new draft is linked on the page", Boolean(id) && linked > 0, id ?? "no id");

// A rename is server-rendered too, so it has to repaint the same way.
const renamed = `${name} renamed`;
await call("update_environment", { id, expected_revision: 1, name: renamed });
check("update_environment repaints without a reload", (await onScreen()).includes(renamed));

// A reload must not reveal anything the page was not already showing.
const beforeReload = await onScreen();
await page.reload({ waitUntil: "networkidle" });
check("a manual reload adds nothing new", (await onScreen()) === beforeReload);

// The same has to hold on the environment's own page, whose heading is
// server-rendered from the record the agent is editing.
await call("open_environment", { id });
const heading = () => page.locator("main h1").first().innerText();
console.log("on env page:", JSON.stringify(await heading()));

const again = `${name} again`;
await call("update_environment", { id, expected_revision: 2, name: again });
const edited = await heading();
check("the env page tracks an edit without a reload", edited.includes(again), edited);

await forget([id]);

await browser.close();
console.log(failures.length ? `\nFAILED: ${failures.join(", ")}` : "\nall good");
process.exit(failures.length ? 1 : 0);
