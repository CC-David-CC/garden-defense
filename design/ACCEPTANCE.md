> Original design reference from 2026-10-30. This describes intended behavior, not current implementation or qualification. The current app README is authoritative for status. Pseudocode and template JSON here are documentation, not build entries.

# Acceptance — Garden Defense

**All runtime cases are NOT RUN.** This file is a plan; document checks are not gameplay evidence.

Apply all C01–C24 in [common acceptance](../../../../../docs/games/design-reference/ACCEPTANCE-COMMON.md). No immersive support is claimed or required for this flat-screen app.

## Game-specific cases

| ID | Experiment / invariant | Status |
|---|---|---|
| garden-defense-G01 | Currency cannot go negative on double-tap purchase. | not_run |
| garden-defense-G02 | Sold tower cannot fire a delayed projectile. | not_run |
| garden-defense-G03 | 2× changes rate not logical outcomes for the same command schedule. | not_run |
| garden-defense-G04 | Empty wave cannot award twice. | not_run |
| garden-defense-G05 | Save mid-wave preserves enemy progress and pending projectiles. | not_run |
| garden-defense-G06 | Upgrade menu does not leak a build click into the map. | not_run |

## Release evidence

Record rules/content and dependency versions, actual asset names/hashes, desktop browser, real phone and (where required) Galaxy XR build, commands/logs, complete-playthrough result, save restoration result, multiwindow/late-disposal behavior, frame timing and unresolved defects. Exercise actual Rive properties and texture input rather than substituting an HTML mock.

A pure rules unit test, a visual smoke test and a hardware XR test are different evidence. Preserve that distinction. All promised features must be demonstrated or explicitly left incomplete; do not relabel a generic engine scene as the finished game.
