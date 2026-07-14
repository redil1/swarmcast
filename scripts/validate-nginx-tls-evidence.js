import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const allowSynthetic = args.includes("--allow-synthetic");
const files = args.filter((arg) => !arg.startsWith("--"));
const hostnamePattern = /^(?!.*(?:example|localhost|127\.0\.0\.1|0\.0\.0\.0))[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i;
const sensitiveEvidencePatterns = [
  /token=/i,
  /jwt=/i,
  /bearer\s+/i,
  /sourceurl/i,
  /source_url/i,
  /\.m3u8(?:\?|$)/i,
  /-----BEGIN/i,
  /password=/i,
  /email=/i
];

function fail(message) {
  throw new Error(message);
}

function cleanString(name, value, pattern) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) fail(`${name} has invalid format`);
  return normalized;
}

function parseTime(name, value) {
  const normalized = cleanString(name, value);
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) fail(`${name} must be ISO-8601 parseable`);
  return time;
}

function nonNegativeNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${name} must be a non-negative number`);
  return value;
}

function validateEvidenceList(name, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${name} must include evidence`);
  const normalized = [];
  for (const item of evidence) {
    const value = cleanString(`${name}[]`, item);
    if (sensitiveEvidencePatterns.some((pattern) => pattern.test(value))) {
      fail(`${name} evidence reference looks like it may contain sensitive material`);
    }
    normalized.push(value);
  }
  return normalized;
}

function requireEvidenceMarker(name, evidence, marker) {
  if (!evidence.some((item) => item.includes(marker))) fail(`${name} evidence must mention ${marker}`);
}

function validateTls(prefix, tls, completedAt) {
  if (!tls || typeof tls !== "object" || Array.isArray(tls)) fail(`${prefix}.tls is required`);
  if (tls.validCertificate !== true) fail(`${prefix}.tls.validCertificate must be true`);
  if (tls.hostnameVerified !== true) fail(`${prefix}.tls.hostnameVerified must be true`);
  cleanString(`${prefix}.tls.protocol`, tls.protocol, /^TLSv1\.[23]$/);
  const expiresAt = parseTime(`${prefix}.tls.expiresAt`, tls.expiresAt);
  if (expiresAt <= completedAt) fail(`${prefix}.tls.expiresAt must be after completedAt`);
  const evidence = validateEvidenceList(`${prefix}.tls.evidence`, tls.evidence);
  requireEvidenceMarker(`${prefix}.tls.evidence`, evidence, "valid-certificate");
  requireEvidenceMarker(`${prefix}.tls.evidence`, evidence, "hostname-verified");
}

function validateOrigin(origin, completedAt) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) fail("origin is required");
  cleanString("origin.host", origin.host, hostnamePattern);
  validateTls("origin", origin.tls, completedAt);
  if (origin.unauthorizedPlaylistStatus !== 401) fail("origin.unauthorizedPlaylistStatus must be 401");
  if (origin.authorizedPlaylistStatus !== 200) fail("origin.authorizedPlaylistStatus must be 200");
  if (origin.authorizedSegmentStatus !== 200) fail("origin.authorizedSegmentStatus must be 200");
  if (origin.playlistNoCache !== true) fail("origin.playlistNoCache must be true");
  if (origin.segmentImmutableCache !== true) fail("origin.segmentImmutableCache must be true");
  if (origin.sourceUrlLeaked !== false) fail("origin.sourceUrlLeaked must be false");
  nonNegativeNumber("origin.startupLatencyMs", origin.startupLatencyMs);
  const evidence = validateEvidenceList("origin.evidence", origin.evidence);
  for (const marker of [
    "origin-auth-401",
    "origin-playlist-200",
    "origin-segment-200",
    "playlist-no-cache",
    "segment-immutable-cache",
    "source-url-redaction"
  ]) {
    requireEvidenceMarker("origin.evidence", evidence, marker);
  }
}

function validateEdge(edge, completedAt) {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) fail("edge is required");
  cleanString("edge.host", edge.host, hostnamePattern);
  validateTls("edge", edge.tls, completedAt);
  if (edge.unauthorizedSegmentStatus !== 401) fail("edge.unauthorizedSegmentStatus must be 401");
  if (edge.firstSegmentStatus !== 200) fail("edge.firstSegmentStatus must be 200");
  if (edge.secondSegmentStatus !== 200) fail("edge.secondSegmentStatus must be 200");
  cleanString("edge.firstCacheStatus", edge.firstCacheStatus, /^MISS$/);
  cleanString("edge.secondCacheStatus", edge.secondCacheStatus, /^HIT$/);
  if (edge.crossTokenHit !== true) fail("edge.crossTokenHit must be true");
  if (edge.originFills !== 1) fail("edge.originFills must be 1");
  if (edge.thirdPartyCdnUsed !== false) fail("edge.thirdPartyCdnUsed must be false");
  if (edge.tokenLeakedInCacheKey !== false) fail("edge.tokenLeakedInCacheKey must be false");
  nonNegativeNumber("edge.cacheHitLatencyMs", edge.cacheHitLatencyMs);
  const evidence = validateEvidenceList("edge.evidence", edge.evidence);
  for (const marker of [
    "edge-auth-401",
    "edge-cache-miss",
    "edge-cache-hit",
    "cross-token-hit",
    "origin-fills=1",
    "no-third-party-cdn",
    "cache-key-redaction"
  ]) {
    requireEvidenceMarker("edge.evidence", evidence, marker);
  }
}

function validateRecord(record, file) {
  cleanString("evidenceId", record.evidenceId, /^[a-z0-9][a-z0-9._-]*$/);
  cleanString("environment", record.environment, /^(staging|production)$/);
  cleanString("commit", record.commit, /^[a-fA-F0-9]{7,40}$/);
  cleanString("releaseVersion", record.releaseVersion, /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/);
  const startedAt = parseTime("startedAt", record.startedAt);
  const completedAt = parseTime("completedAt", record.completedAt);
  if (completedAt <= startedAt) fail("completedAt must be after startedAt");
  if (record.localOriginSmokePassed !== true) fail("localOriginSmokePassed must be true");
  if (record.localEdgeSmokePassed !== true) fail("localEdgeSmokePassed must be true");
  if (record.synthetic && !allowSynthetic) fail("synthetic nginx/TLS evidence requires --allow-synthetic");
  validateOrigin(record.origin, completedAt);
  validateEdge(record.edge, completedAt);

  const incomplete = [];
  if (record.environment !== "production") incomplete.push("environment");
  if (incomplete.length > 0 && !allowIncomplete && !record.synthetic) {
    fail(`nginx/TLS evidence is incomplete for launch: ${incomplete.join(", ")}`);
  }
  const status = incomplete.length === 0 ? "launch-ready" : `shape-only incomplete=${incomplete.length}`;
  return `${file}: nginx/TLS evidence OK: origin=${record.origin.host}, edge=${record.edge.host}, status=${status}`;
}

if (files.length === 0) {
  console.error("Usage: node scripts/validate-nginx-tls-evidence.js [--allow-incomplete] [--allow-synthetic] <nginx-tls-evidence.json> [...]");
  process.exit(2);
}

try {
  for (const file of files) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    console.log(validateRecord(record, file));
  }
} catch (error) {
  console.error(`nginx/TLS evidence validation failed: ${error.message}`);
  process.exit(1);
}
