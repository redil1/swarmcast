# Test Fixtures

Reusable fixtures live under `test-fixtures/`.

## Catalog

- `test-fixtures/catalog/sample.m3u`: valid two-channel catalog.
- `test-fixtures/catalog/duplicates-malformed.m3u`: orphan URLs, duplicate source URLs, and missing optional metadata.

## Media Bytes

- `test-fixtures/media/segment-ok.bytes`: verified segment byte fixture for hash/store tests.
- `test-fixtures/media/segment-corrupt.bytes`: intentionally different bytes for corruption and poisoning tests.

## Real fMP4

- `test-fixtures/media/fmp4/init.mp4`: real two-track H.264/AAC ISO-BMFF initialization segment with `ftyp` and `moov` boxes.
- `test-fixtures/media/fmp4/seg_00000000.m4s` and `test-fixtures/media/fmp4/seg_00000001.m4s`: two real two-second fragments with `moof`, per-track `traf`, and non-empty `mdat` payloads.
- `test-fixtures/media/fmp4/playlist.m3u8`: finite HLS version 7 playlist binding the init segment and both fragments.
- `test-fixtures/media/fmp4/manifest.json`: ffmpeg provenance plus exact file paths, sizes, and SHA-256 hashes.

The sample was generated exclusively from ffmpeg `lavfi` `testsrc2` video and `sine` audio. It contains no upstream media or customer data. The complete generation command is preserved as data in the manifest. Validate the committed files with:

```bash
npm run media:fixtures:validate
npm run smoke:fmp4-fixture-validation
```

The validator parses ISO-BMFF boundaries without ffmpeg, requires two audio/video tracks, verifies the exact playlist references, and hash-binds every file. Ingest applies the same media-fragment structural validation before calculating SHA-256 or announcing a `.m4s` segment.

## Distributions

- `test-fixtures/distributions/zipf-small.json`: deterministic Zipf-style popularity fixture.

## Retention

- `test-fixtures/retention/records.jsonl`: deterministic operational-record fixture for the retention job runner.
- `test-fixtures/retention/sensitive-records.jsonl`: synthetic sentinel fixture for retention redaction tests. These values are intentionally fake and must not be replaced with real URLs, credentials, IPs, contact data, or customer payloads.

## Rules

- Fixtures must be deterministic and safe to commit.
- Fixture files should not include private source URLs, credentials, JWTs, or real customer data.
- Large generated fMP4 fixtures should be produced by smokes. The committed 99,901-byte fMP4 set is the small regression sample explicitly required by `Q-005`; replacing it requires a new manifest and review of provenance, size, hashes, tracks, playlist references, and parser coverage.
