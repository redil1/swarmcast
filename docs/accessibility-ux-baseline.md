# Accessibility And UX Baseline

Review date: 2026-07-05

This baseline covers the Android catalog, playback, privacy, and P2P settings surface. It is a launch gate, not a polish backlog. Local Android compile now passes; real-device verification is still required before this can be marked complete.

## Baseline Requirements

| Area | Requirement | Current Evidence | Open Gate |
|---|---|---|---|
| Catalog search | Search field has a clear label, supports refresh, preserves state, and shows cached results before network refresh. | Compose catalog screen, `CatalogViewModel`, disk cache. | Run TalkBack and large-font checks on a real device. |
| Channel list | Rows have stable keys, readable names, group metadata, and accessibility descriptions. | `items(items = channels, key = { it.id })`, channel row semantics. | Verify focus order and touch target size on device. |
| Player controls | Player surface is reachable and labelled for assistive tech. | `PlayerView` is hosted through `AndroidView` with content description. | Verify Media3 controls, pause/play, seek, and captions behavior on device. |
| Error states | Errors are visible and announced without exposing secrets, source URLs, or JWTs. | Error text uses assertive live-region semantics. | Add structured error mapping from shared taxonomy to user-safe strings. |
| Loading states | Loading and empty catalog states are explicit and accessible. | Loading state uses polite live-region semantics; empty state is visible. | Add pagination/loading-more affordance when infinite scroll is implemented. |
| Settings | P2P upload can be toggled and state is announced. | Switch has state description; privacy dialog explains peer IP visibility. | Confirm disabling P2P closes active peer links during device testing. |
| Localization readiness | User-visible strings are in Android resources, not embedded in composables. | `android/app/src/main/res/values/strings.xml`. | Add translation workflow and pseudo-locale screenshot pass before public launch. |

## Required Checks

- TalkBack can reach search, refresh, channel rows, player controls, privacy dialog, and P2P upload switch in a predictable order.
- Font scaling at 200% does not hide primary controls or make channel rows unusable.
- Touch targets for refresh, privacy, P2P switch, and channel rows meet Android accessibility guidance.
- Error messages are short, actionable, and use client-visible error taxonomy strings.
- Loading, empty, offline/cache, and failed-refresh states are distinguishable.
- P2P upload settings remain available before and during playback.
- No user-facing string is introduced outside Android resources unless it is dynamic server data.

## Launch Gates

- Android debug and release builds pass with resource validation.
- Real-device TalkBack pass is recorded.
- Large-font 200% and small-screen screenshots are reviewed.
- Touch-target evidence is recorded for refresh, channel rows, player controls, privacy dialog, and P2P upload controls.
- Media3 controls are verified for keyboard/accessibility focus.
- Localization owner approves string extraction and pseudo-locale behavior.
- Accessibility evidence must pass validation before launch:

```bash
npm run android:accessibility:validate -- path/to/android-accessibility-evidence.json
```

Synthetic fixtures must be validated explicitly:

```bash
npm run android:accessibility:validate -- --allow-synthetic test-fixtures/android/accessibility-complete.synthetic.json
```

Local guard coverage remains:

```bash
npm run smoke:android-accessibility-evidence-validation
```
