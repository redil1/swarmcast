import { readFileSync } from "node:fs";
import { selectOwnedImageRef } from "../packages/config/src/imageRefs.js";

const image = process.argv[2];

try {
  const repoDigests = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(`${selectOwnedImageRef(image, repoDigests)}\n`);
} catch (error) {
  console.error(`Owned image digest selection failed: ${error.message}`);
  process.exit(1);
}
