import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { convertBackupFile, convertBackupText } from "./convert-channel-backup-to-m3u.js";

const fixture = [
  "101|News, International|https://stream.example/live/101|https://logo.example/101.png|News|medium|1|1",
  "102|قناة الأخبار|https://stream.example/live/102|not-a-url|Arabic \"News\"|medium|2|1",
  "103|Duplicate|https://stream.example/live/101||News|medium|3|1"
].join("\n");

const converted = convertBackupText(fixture);
assert.equal(converted.stats.inputRows, 3);
assert.equal(converted.stats.generatedEntries, 3);
assert.equal(converted.stats.uniqueSourceUrls, 2);
assert.equal(converted.stats.duplicateSourceUrls, 1);
assert.equal(converted.stats.uniqueSourceHosts, 1);
assert.equal(converted.stats.omittedLogos, 1);
assert.match(converted.m3u, /News; International/);
assert.match(converted.m3u, /group-title="Arabic 'News'"/);
assert.doesNotMatch(converted.m3u, /tvg-logo="not-a-url"/);
assert.throws(() => convertBackupText("broken|row"), /expected 8/);
assert.throws(() => convertBackupText("1|Name|file:\/\/source|||||"), /HTTP\(S\)/);

const workDir = mkdtempSync(path.join(tmpdir(), "swarmcast-backup-converter-"));
const inputPath = path.join(workDir, "backup.txt");
const outputPath = path.join(workDir, "source.m3u");
const hostsPath = path.join(workDir, "hosts.txt");
writeFileSync(inputPath, fixture);

const stats = convertBackupFile({ inputPath, outputPath, hostsOutputPath: hostsPath });
assert.equal(stats.generatedEntries, 3);
assert.equal(statSync(outputPath).mode & 0o777, 0o600);
assert.equal(statSync(hostsPath).mode & 0o777, 0o600);
assert.equal(readFileSync(hostsPath, "utf8"), "stream.example\n");
assert.throws(
  () => convertBackupFile({ inputPath, outputPath }),
  /output already exists/
);
convertBackupFile({ inputPath, outputPath, force: true });

console.log(JSON.stringify({ ok: true, ...stats }));
