import esbuild from "esbuild";
await esbuild.build({ entryPoints: ["tests/scoring.test.ts"], bundle: true, platform: "node", format: "esm", outfile: "dist-test/scoring.test.mjs" });
