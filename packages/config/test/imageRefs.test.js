import assert from "node:assert/strict";
import test from "node:test";
import { selectOwnedImageRef } from "../src/imageRefs.js";

const digest = (char) => `sha256:${char.repeat(64)}`;

test("selectOwnedImageRef chooses the owned digest when upstream appears first", () => {
  assert.equal(selectOwnedImageRef("ghcr.io/redil1/swarmcast/node-exporter", [
    `prom/node-exporter@${digest("a")}`,
    `ghcr.io/redil1/swarmcast/node-exporter@${digest("a")}`
  ]), `ghcr.io/redil1/swarmcast/node-exporter@${digest("a")}`);
});

test("selectOwnedImageRef normalizes repository name and refs", () => {
  assert.equal(selectOwnedImageRef("GHCR.IO/REDIL1/SWARMCAST/AUTH", [
    ` GHCR.IO/REDIL1/SWARMCAST/AUTH@${digest("b")} `
  ]), `ghcr.io/redil1/swarmcast/auth@${digest("b")}`);
});

test("selectOwnedImageRef rejects missing, malformed, and ambiguous owned digests", () => {
  assert.throws(() => selectOwnedImageRef("ghcr.io/redil1/swarmcast/auth", [
    `docker.io/library/node@${digest("c")}`
  ]), /found 0/);
  assert.throws(() => selectOwnedImageRef("ghcr.io/redil1/swarmcast/auth", [
    "ghcr.io/redil1/swarmcast/auth@sha256:short"
  ]), /found 0/);
  assert.throws(() => selectOwnedImageRef("ghcr.io/redil1/swarmcast/auth", [
    `ghcr.io/redil1/swarmcast/auth@${digest("d")}`,
    `ghcr.io/redil1/swarmcast/auth@${digest("e")}`
  ]), /found 2/);
});

test("selectOwnedImageRef rejects unsafe image inputs", () => {
  assert.throws(() => selectOwnedImageRef("", []), /normalized repository/);
  assert.throws(() => selectOwnedImageRef(`ghcr.io/repo/auth@${digest("f")}`, []), /normalized repository/);
  assert.throws(() => selectOwnedImageRef("ghcr.io/repo/bad image", []), /normalized repository/);
  assert.throws(() => selectOwnedImageRef("ghcr.io/repo/auth", "not-an-array"), /must be an array/);
});
