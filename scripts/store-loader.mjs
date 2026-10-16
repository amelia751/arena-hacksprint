/**
 * Lets the store test run the real module against a blob store that can be told
 * to fail: strips the types off `.ts` files and swaps `@netlify/blobs` for the
 * stub the test controls.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const STUB = pathToFileURL(
  fileURLToPath(new URL("./blobs-stub.mjs", import.meta.url)),
).href;

export async function resolve(specifier, context, next) {
  if (specifier === "@netlify/blobs") return { url: STUB, shortCircuit: true };
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export{}", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const url = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    return next(url.endsWith(".ts") ? url : `${url}.ts`, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith(".ts")) return next(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
