import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./store-loader.mjs", pathToFileURL(import.meta.filename));
