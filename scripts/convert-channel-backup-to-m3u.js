import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_FIELDS = 8;
const MAX_LOGO_URL_LENGTH = 2048;

function cleanInline(value, { commas = false } = {}) {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replaceAll('"', "'")
    .trim();
  return commas ? cleaned.replaceAll(",", ";") : cleaned;
}

function parseHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  return parsed;
}

function validLogoUrl(value) {
  if (!value || value.length > MAX_LOGO_URL_LENGTH) return false;
  try {
    parseHttpUrl(value, "logo URL");
    return true;
  } catch {
    return false;
  }
}

export function convertBackupText(text) {
  const rows = text.split(/\r?\n/).filter((line) => line.trim());
  if (rows.length === 0) throw new Error("channel backup is empty");

  const output = ["#EXTM3U"];
  const sourceUrls = new Set();
  const sourceHosts = new Set();
  let omittedLogos = 0;

  rows.forEach((row, index) => {
    const fields = row.split("|");
    if (fields.length !== EXPECTED_FIELDS) {
      throw new Error(`row ${index + 1} has ${fields.length} fields; expected ${EXPECTED_FIELDS}`);
    }

    const tvgId = cleanInline(fields[0]) || `row-${index + 1}`;
    const name = cleanInline(fields[1], { commas: true }) || "Unnamed Channel";
    const sourceUrl = fields[2].trim();
    const parsedSource = parseHttpUrl(sourceUrl, `row ${index + 1} source URL`);
    const logo = fields[3].trim();
    const group = cleanInline(fields[4]);

    sourceUrls.add(sourceUrl);
    sourceHosts.add(parsedSource.hostname.toLowerCase());

    const attributes = [`tvg-id="${tvgId}"`, `group-title="${group}"`];
    if (logo) {
      if (validLogoUrl(logo)) attributes.splice(1, 0, `tvg-logo="${cleanInline(logo)}"`);
      else omittedLogos += 1;
    }

    output.push(`#EXTINF:-1 ${attributes.join(" ")},${name}`);
    output.push(sourceUrl);
  });

  const m3u = `${output.join("\n")}\n`;
  return {
    m3u,
    sourceHosts: [...sourceHosts].sort(),
    stats: {
      inputRows: rows.length,
      generatedEntries: rows.length,
      uniqueSourceUrls: sourceUrls.size,
      duplicateSourceUrls: rows.length - sourceUrls.size,
      uniqueSourceHosts: sourceHosts.size,
      omittedLogos,
      outputBytes: Buffer.byteLength(m3u),
      sha256: createHash("sha256").update(m3u).digest("hex")
    }
  };
}

function writeSecureAtomic(outputPath, contents, { force = false } = {}) {
  const resolved = path.resolve(outputPath);
  if (!force && existsSync(resolved)) {
    throw new Error(`output already exists: ${resolved}; pass --force to replace it`);
  }

  const tempPath = `${resolved}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, resolved);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

export function convertBackupFile({ inputPath, outputPath, hostsOutputPath = "", force = false }) {
  if (!inputPath || !outputPath) throw new Error("inputPath and outputPath are required");
  const result = convertBackupText(readFileSync(inputPath, "utf8"));
  writeSecureAtomic(outputPath, result.m3u, { force });
  if (hostsOutputPath) {
    writeSecureAtomic(hostsOutputPath, `${result.sourceHosts.join("\n")}\n`, { force });
  }
  return result.stats;
}

function parseOptions(argv) {
  const options = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    const key = {
      "--input": "inputPath",
      "--output": "outputPath",
      "--hosts-output": "hostsOutputPath"
    }[arg];
    if (!key || !argv[index + 1]) throw new Error(`unknown or incomplete argument: ${arg}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const stats = convertBackupFile(parseOptions(process.argv.slice(2)));
    console.log(JSON.stringify({ ok: true, ...stats }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
