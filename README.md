# Garden Defense — desktop integration

Garden Defense is a Phaser 4.2.1 tower-defense game built on the completed
deterministic ten-wave model. Three maps share fixed paths and eight build
sites. Rapid, splash and slow towers have two upgrade levels; the player can
pause while planning, switch explicit 1×/2× simulation speed, and must start
each wave.

Each window owns its Phaser renderer, audio context, pointer and focus
listeners, file subscription and disposal scope. The renderer is a view of the
model's health, currency, towers, enemies and projectiles.

Save and Open use the signed-in desktop's My files. Checkpoints include the
map, wave queue, active enemies, projectile timers, coins, health, towers and
RNG state. Files are validated before replacing the live garden and restore
paused. Changed and conflicting files remain visible without replacing play.

## Current limitation

No authored `garden-advisor.riv` is supplied. The advisor is an explicit
development fallback, so the Rive acceptance gate remains open. Physical-phone
testing and a complete three-map, thirty-wave release playthrough remain open.
