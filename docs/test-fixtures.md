# Test Fixtures

Reusable fixtures live under `test-fixtures/`.

## Catalog

- `test-fixtures/catalog/sample.m3u`: valid two-channel catalog.
- `test-fixtures/catalog/duplicates-malformed.m3u`: orphan URLs, duplicate source URLs, and missing optional metadata.

## Media Bytes

- `test-fixtures/media/segment-ok.bytes`: verified segment byte fixture for hash/store tests.
- `test-fixtures/media/segment-corrupt.bytes`: intentionally different bytes for corruption and poisoning tests.

## Distributions

- `test-fixtures/distributions/zipf-small.json`: deterministic Zipf-style popularity fixture.

## Retention

- `test-fixtures/retention/records.jsonl`: deterministic operational-record fixture for the retention job runner.
- `test-fixtures/retention/sensitive-records.jsonl`: synthetic sentinel fixture for retention redaction tests. These values are intentionally fake and must not be replaced with real URLs, credentials, IPs, contact data, or customer payloads.

## Rules

- Fixtures must be deterministic and safe to commit.
- Fixture files should not include private source URLs, credentials, JWTs, or real customer data.
- Large generated fMP4 fixtures should be produced by smokes unless a small committed file is explicitly required.
