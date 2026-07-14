# Legal Gate

SwarmCast redistributes live streams and also asks viewer devices to relay stream data to other viewers. A normal subscription that allows viewing is not enough.

Before any real content is tested outside private engineering smoke tests, obtain written confirmation that the upstream rights allow:

- Redistribution or rebroadcast to the intended audience.
- Peer relay from viewer devices to other viewers.
- The target countries or regions.
- The intended devices and app stores.
- Any logging, metrics, or privacy obligations.

Machine-readable approval evidence must include explicit references for `redistribution-rights`, `rebroadcast-rights`, `peer-relay-rights`, `viewer-device-retransmission`, `territory-platform-scope`, `app-store-distribution`, `operational-metrics-logging`, and `privacy-disclosure`. These references must point to signed approval artifacts, contract summaries, or legal review records; do not include raw source URLs, tokens, email addresses, or private contract text.

Project launch gate:

- Signed approval evidence must pass:

```bash
npm run legal:approval:validate -- path/to/legal-approval.json
```

Synthetic shape checks can use:

```bash
npm run legal:approval:validate -- --allow-synthetic test-fixtures/legal/legal-approval-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:legal-approval-validation
```

- No production m3u source is configured until this document links to the signed approval or contract summary.
- No public beta starts until privacy copy discloses peer IP visibility and upload behavior.
