import { describe, expect, it } from "vitest";
import {
  GardenDefenseSession,
  decodeSave,
  encodeSave,
  sessionFromSave,
} from "../src/model/garden.js";

describe("GardenDefenseSession rules", () => {
  it("currency cannot go negative on a double-tap purchase", () => {
    const session = new GardenDefenseSession("purchase", 0);
    session.coins = 50;
    expect(session.buildTower(0, "rapid")).toBe(true);
    expect(session.coins).toBe(0);
    expect(session.buildTower(1, "rapid")).toBe(false);
    expect(session.coins).toBe(0);
  });

  it("selling a tower removes its delayed projectiles", () => {
    const session = new GardenDefenseSession("sell", 0);
    session.buildTower(7, "rapid");
    session.startWave();
    for (let i = 0; i < 6; i += 1) session.advance(250); // spawn and let the tower fire
    expect(session.projectiles.length).toBeGreaterThan(0);
    session.sellTower(7);
    expect(session.projectiles).toHaveLength(0);
  });

  it("2x changes rate, not logical outcomes for the same command schedule", () => {
    const slow = new GardenDefenseSession("speed-a", 0);
    const fast = new GardenDefenseSession("speed-b", 0);
    fast.setSpeed(2);
    slow.buildTower(0, "rapid");
    fast.buildTower(0, "rapid");
    slow.startWave();
    fast.startWave();
    for (let i = 0; i < 20; i += 1) {
      slow.advance(500);
      fast.advance(250); // same simulated time, different chunking
    }
    expect(slow.wave).toBe(fast.wave);
    expect(slow.health).toBe(fast.health);
  });

  it("an empty wave cannot award twice", () => {
    const session = new GardenDefenseSession("reward", 0);
    session.wave = 9;
    session.startWave();
    for (let elapsed = 0; elapsed < 120_000 && session.waveActive; elapsed += 250) session.advance(250);
    const coins = session.coins;
    session.advance(1000);
    expect(session.coins).toBe(coins);
  });

  it("save mid-wave preserves enemies and pending projectiles", () => {
    const session = new GardenDefenseSession("save", 1);
    session.buildTower(0, "rapid");
    session.startWave();
    for (let i = 0; i < 12; i += 1) session.advance(250);
    const restored = sessionFromSave(decodeSave(encodeSave(session)));
    expect(restored.enemies.map((enemy) => ({ ...enemy }))).toEqual(
      session.enemies.map((enemy) => ({ ...enemy })),
    );
    expect(restored.projectiles.map((p) => ({ ...p }))).toEqual(
      session.projectiles.map((p) => ({ ...p })),
    );
  });

  it("save restores fractional spawn time and rejects malformed fields", () => {
    const session = new GardenDefenseSession("fractional", 2);
    session.startWave();
    session.advance(1);
    const saved = encodeSave(session);
    const restored = sessionFromSave(decodeSave(saved));
    expect(restored.spawnMs).toBe(session.spawnMs);
    const malformed = JSON.parse(saved);
    malformed.payload.health = -1;
    expect(() => decodeSave(JSON.stringify(malformed))).toThrow();
  });

  it("the upgrade menu never leaks a build click into the map", () => {
    const session = new GardenDefenseSession("menu", 0);
    session.openBuildMenu(2);
    expect(session.buildMenuOpen).toBe(true);
    session.buildTower(2, "slow"); // a deliberate build, not a leaked click
    expect(session.buildMenuOpen).toBe(false);
    expect(session.towers).toHaveLength(1);
  });
});
