# Launch Artifact Bundle

The final launch record is not trusted from evidence labels alone. It must bind the exact release evidence files by SHA-256 and each file must pass its repository-owned validator.

## Contract

A complete launch artifact bundle covers all 34 launch gates with exactly 53 artifacts. The validator runs 38 fixed validation groups. Artifact input cannot select or replace commands.

The bundle enforces:

- one unique repository-relative path per artifact ID
- regular, non-symlink files no larger than 64 MiB
- exact SHA-256 checks before validation
- no `test-fixtures/` paths in a production bundle
- matching release version, commit, and synthetic mode
- the exact gate, artifact, and validator inventories
- rejection of synthetic JSON content in a production bundle
- fixed validator execution with no shell and a minimal inherited environment

Use `test-fixtures/launch/evidence-artifact-inventory.complete.synthetic.json` as the shape reference. Replace every synthetic path with the immutable real evidence path for the release. Do not reuse one file for multiple artifact IDs.

## Generate

Set `synthetic` to `false`, bind the release version and full commit, and set `generatedAt` after all evidence files have been finalized. Generate to a new release-specific path:

```bash
npm run launch:artifacts:generate -- \
  --inventory evidence/launch/v1.0.0/artifact-inventory.json \
  --output evidence/launch/v1.0.0/artifact-bundle-20260721T120000Z.json
```

Generation fails unless the inventory contains the exact artifact set and every fixed validator passes. The output is created with mode `0600` and exclusive-create semantics; an existing bundle is never overwritten.

Do not edit the generated bundle. If an artifact, release binding, or timestamp changes, generate a new bundle at a new path and repeat approval.

## Approve

Compute the bundle hash and place the path and hash in the schema-version-2 launch record:

```bash
shasum -a 256 evidence/launch/v1.0.0/artifact-bundle-20260721T120000Z.json
```

The launch record must set `environment` to `production`, set `synthetic` to `false`, and contain this binding:

```json
{
  "artifactBundle": {
    "path": "evidence/launch/v1.0.0/artifact-bundle-20260721T120000Z.json",
    "sha256": "64-lowercase-hex-characters"
  }
}
```

Three distinct people must approve after `generatedAt` and no later than the launch record's final `reviewedAt`. Required roles are `release`, `operations`, and `security`; a person cannot fill more than one role.

## Validate

Run the final check from the repository root:

```bash
npm run launch:evidence:validate -- evidence/launch/v1.0.0/launch-evidence.json
```

The result can report `launch-ready` only after the bundle hash, all 53 artifact hashes, all 38 fixed validation groups, every launch gate, and all three approvals pass. `--allow-synthetic` and `--allow-incomplete` are rehearsal-only flags and are prohibited for production approval.
