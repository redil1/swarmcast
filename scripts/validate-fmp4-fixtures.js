import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  inspectFmp4InitSegment,
  inspectFmp4MediaSegment
} from "../services/ingest/src/isoBmff.js";

const MANIFEST_KEYS = new Set(["schemaVersion", "containsCustomerData", "generator", "files"]);
const GENERATOR_KEYS = new Set(["tool", "version", "command"]);
const FILE_KEYS = new Set(["id", "path", "size", "sha256"]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
const EXPECTED_FILES = new Map([
  ["init", "test-fixtures/media/fmp4/init.mp4"],
  ["playlist", "test-fixtures/media/fmp4/playlist.m3u8"],
  ["segment-0", "test-fixtures/media/fmp4/seg_00000000.m4s"],
  ["segment-1", "test-fixtures/media/fmp4/seg_00000001.m4s"]
]);

function exactObject(name, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    throw new Error(`${name} has unsupported or missing fields`);
  }
}

function cleanString(name, value, pattern = null) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) throw new Error(`${name} has invalid format`);
  return normalized;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function exactSubsequence(values, expected) {
  for (let offset = 0; offset <= values.length - expected.length; offset += 1) {
    if (expected.every((value, index) => values[offset + index] === value)) return true;
  }
  return false;
}

function validateGenerator(generator) {
  exactObject("generator", generator, GENERATOR_KEYS);
  if (generator.tool !== "ffmpeg") throw new Error("generator.tool must equal ffmpeg");
  cleanString("generator.version", generator.version, /^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/);
  if (!Array.isArray(generator.command) || generator.command.some((value) => typeof value !== "string" || value === "")) {
    throw new Error("generator.command must be a non-empty string array");
  }
  for (const required of [
    ["-f", "lavfi"],
    ["-c:v", "libx264"],
    ["-c:a", "aac"],
    ["-hls_time", "2"],
    ["-hls_segment_type", "fmp4"],
    ["-hls_fmp4_init_filename", "init.mp4"]
  ]) {
    if (!exactSubsequence(generator.command, required)) {
      throw new Error(`generator.command must contain ${required.join(" ")}`);
    }
  }
  if (!generator.command.some((value) => value.startsWith("testsrc2=")) || !generator.command.some((value) => value.startsWith("sine="))) {
    throw new Error("generator.command must use synthetic video and audio sources");
  }
}

function validateFixturePath(id, value, rootDirectory) {
  const expected = EXPECTED_FILES.get(id);
  if (value !== expected) throw new Error(`${id}.path must equal ${expected}`);
  const root = realpathSync(path.resolve(rootDirectory));
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${id}.path escapes the repository root`);
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${id} must be a regular non-symlink file`);
  const real = realpathSync(resolved);
  if (real !== resolved || !real.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${id}.path must not traverse symlinks or escape the repository root`);
  }
  if (stat.size <= 0 || stat.size > MAX_FIXTURE_BYTES) throw new Error(`${id} has invalid size`);
  return { resolved, stat };
}

function validatePlaylist(buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("playlist must be valid UTF-8");
  }
  const lines = text.trim().split(/\r?\n/);
  if (lines[0] !== "#EXTM3U") throw new Error("playlist must start with #EXTM3U");
  for (const required of [
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:2",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-MAP:URI=\"init.mp4\"",
    "#EXT-X-ENDLIST"
  ]) {
    if (!lines.includes(required)) throw new Error(`playlist must contain ${required}`);
  }
  const segments = lines.filter((line) => line && !line.startsWith("#"));
  if (segments.length !== 2 || segments[0] !== "seg_00000000.m4s" || segments[1] !== "seg_00000001.m4s") {
    throw new Error("playlist must reference the exact two committed media segments");
  }
  if (lines.filter((line) => line.startsWith("#EXTINF:2.")).length !== 2) {
    throw new Error("playlist must contain two two-second media durations");
  }
}

export function validateFmp4FixtureManifest(input, { rootDirectory = process.cwd() } = {}) {
  exactObject("fMP4 fixture manifest", input, MANIFEST_KEYS);
  if (input.schemaVersion !== 1) throw new Error("schemaVersion must equal 1");
  if (input.containsCustomerData !== false) throw new Error("containsCustomerData must be false");
  validateGenerator(input.generator);
  if (!Array.isArray(input.files) || input.files.length !== EXPECTED_FILES.size) {
    throw new Error(`files must contain exactly ${EXPECTED_FILES.size} fixtures`);
  }

  const files = new Map();
  const paths = new Set();
  for (const [index, file] of input.files.entries()) {
    exactObject(`files[${index}]`, file, FILE_KEYS);
    const id = cleanString(`files[${index}].id`, file.id, /^[a-z0-9][a-z0-9-]*$/);
    if (!EXPECTED_FILES.has(id)) throw new Error(`unexpected fixture ${id}`);
    if (files.has(id)) throw new Error(`duplicate fixture ${id}`);
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`${id}.size must be a positive safe integer`);
    const expectedHash = cleanString(`${id}.sha256`, file.sha256, HASH_PATTERN);
    const fixture = validateFixturePath(id, file.path, rootDirectory);
    if (paths.has(file.path)) throw new Error(`fixture path ${file.path} is assigned more than once`);
    paths.add(file.path);
    if (fixture.stat.size !== file.size) throw new Error(`${id} size does not match manifest`);
    const buffer = readFileSync(fixture.resolved);
    if (sha256(buffer) !== expectedHash) throw new Error(`${id} SHA-256 does not match manifest`);
    files.set(id, { buffer, size: fixture.stat.size });
  }
  for (const id of EXPECTED_FILES.keys()) {
    if (!files.has(id)) throw new Error(`missing fixture ${id}`);
  }

  const init = inspectFmp4InitSegment(files.get("init").buffer);
  const segment0 = inspectFmp4MediaSegment(files.get("segment-0").buffer);
  const segment1 = inspectFmp4MediaSegment(files.get("segment-1").buffer);
  validatePlaylist(files.get("playlist").buffer);
  const initTrackIds = init.tracks.map((track) => track.trackId).sort((a, b) => a - b);
  const handlers = init.tracks.map((track) => track.handlerType).sort();
  if (
    init.trackCount !== 2 ||
    handlers.join(",") !== "soun,vide" ||
    segment0.trackFragmentCount !== 2 ||
    segment1.trackFragmentCount !== 2 ||
    segment0.trackIds.slice().sort((a, b) => a - b).join(",") !== initTrackIds.join(",") ||
    segment1.trackIds.slice().sort((a, b) => a - b).join(",") !== initTrackIds.join(",")
  ) {
    throw new Error("fMP4 fixtures must contain video and audio tracks");
  }
  return {
    fileCount: files.size,
    totalBytes: [...files.values()].reduce((sum, file) => sum + file.size, 0),
    trackCount: init.trackCount,
    segmentCount: 2
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (files.length > 1) {
    console.error("Usage: node scripts/validate-fmp4-fixtures.js [manifest.json]");
    process.exit(2);
  }
  const manifestPath = files[0] || "test-fixtures/media/fmp4/manifest.json";
  try {
    const result = validateFmp4FixtureManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    console.log(`${manifestPath}: fMP4 fixtures OK: files=${result.fileCount}, segments=${result.segmentCount}, tracks=${result.trackCount}, bytes=${result.totalBytes}`);
  } catch (error) {
    console.error(`fMP4 fixture validation failed: ${error.message}`);
    process.exit(1);
  }
}
