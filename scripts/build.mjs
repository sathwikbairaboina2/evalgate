import { build } from "esbuild";

const flag = process.argv.indexOf("--outfile");
const outfile = flag !== -1 && process.argv[flag + 1] ? process.argv[flag + 1] : "dist/cli.js";

await build({
  entryPoints: ["src/bin.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile,
  legalComments: "none",
  // ajv is CommonJS; give the ESM bundle a real `require` for its internal requires.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __evalgateCreateRequire } from 'node:module';\nconst require = __evalgateCreateRequire(import.meta.url);",
  },
});
