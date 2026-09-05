# Verified Cross-Task Playbook Cache

Use this reference only for cache tuning, migration, conflicts, or accuracy review. Normal remote runs use the deterministic helper directly.

## Objective

Reuse only successful semantic repair trajectories without adding a model roundtrip. The cache is queried after the first accepted remote observation in the same persistent runtime cell. A hit returns at most two compact candidates; normal execution uses only the highest-scoring candidate's next precheck and still verifies every mutation.

## Match fingerprint

Use these normalized fields:

```text
problem_class | redacted symptom | OS family/version bucket | app/version bucket | remote client | surface
```

`problem_class` is required. An exact class match is mandatory; patch-level version agreement, redacted symptom token/bigram similarity, and empirical success confidence raise rank. A dissimilar supplied symptom fails the minimum similarity gate. Device ID, account identity, customer name, full paths, screenshots, coordinates, element indexes, and window handles never enter the fingerprint.

## Stored recipe

Each entry stores only:

```text
title | up to 3 prechecks | up to 6 semantic steps
| up to 3 success checks | up to 2 rollback checks
| successes/failures | candidate/trusted/retired
```

Raw typed values, secrets, clipboard contents, device identifiers, screenshots, coordinates, and expiring UI references are removed. Parameters must remain placeholders such as `<MODE>` or `<PACKAGE>`.

## Lifecycle

1. `success_verified=true` is required before recording.
2. The first verified success creates a `candidate`.
3. A second identical verified success with no failure promotes it to `trusted`.
4. A matched recipe that fails its expected postcondition records a failure and falls back to normal diagnosis.
5. Repeated failures retire the recipe. Version mismatches reduce its score rather than forcing reuse.

Use `manage_playbooks.mjs stats`, `list [status]`, `remove <id>`, or `clear-retired` to inspect and maintain local entries without a GUI or model call.

## Zero-roundtrip integration

Run cache lookup in the same cell as `initialObserve()`, then return one combined compact envelope. On a hit, use the recipe to rank hypotheses and select the first separating precheck; do not replay the full trajectory blindly. On verified completion, record the distilled semantic recipe in the same closeout cell before cleanup reporting.

The cache file lives outside the source tree. A junction-backed F-drive install resolves to `F:\computer-use-studio-pro\state\verified-playbooks.json`; a conventional install uses the Codex state directory. The release ZIP never contains customer cache data.
