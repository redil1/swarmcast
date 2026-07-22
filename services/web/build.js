import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all([
  build({
    entryPoints: [join(root, "client/app.js")],
    outfile: join(dist, "app.js"),
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ["chrome100", "firefox100", "safari15.4"],
    define: { "process.env.NODE_ENV": '"production"' }
  }),
  cp(join(root, "client/index.html"), join(dist, "index.html")),
  cp(join(root, "client/styles.css"), join(dist, "styles.css"))
]);
