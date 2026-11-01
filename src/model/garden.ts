import { Rng } from "./rng.js";

export type TowerRole = "rapid" | "splash" | "slow";
export type EnemyKind = "bug" | "beetle" | "moth";

export const WAVE_COUNT = 10;
export const SITE_COUNT = 8;

export interface TowerSpec {
  role: TowerRole;
  cost: number;
  range: number;
  damage: number;
  cooldownMs: number;
}

export const TOWERS: Readonly<Record<TowerRole, TowerSpec>> = {
  rapid: { role: "rapid", cost: 50, range: 3, damage: 4, cooldownMs: 250 },
  splash: { role: "splash", cost: 80, range: 2.5, damage: 10, cooldownMs: 900 },
  slow: { role: "slow", cost: 60, range: 3.5, damage: 2, cooldownMs: 500 },
};

export const ENEMIES: Readonly<Record<EnemyKind, { hp: number; speed: number; bounty: number }>> = {
  bug: { hp: 10, speed: 0.5, bounty: 5 },
  beetle: { hp: 28, speed: 0.32, bounty: 10 },
  moth: { hp: 16, speed: 0.72, bounty: 7 },
};

export function pathForMap(mapId: number): { x: number; y: number }[] {
  const paths = [
    [{ x: 0, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 5 }, { x: 9, y: 5 }],
    [{ x: 0, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 3 }, { x: 9, y: 3 }],
    [{ x: 0, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 4 }, { x: 9, y: 4 }],
  ];
  return paths[mapId % paths.length];
}

export function sitesForMap(mapId: number): { x: number; y: number }[] {
  const sites = [
    { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 }, { x: 7, y: 1 },
    { x: 2, y: 6 }, { x: 5, y: 6 }, { x: 8, y: 6 }, { x: 3, y: 4 },
  ];
  return sites;
}

export interface TowerInstance {
  site: number;
  role: TowerRole;
  level: 1 | 2 | 3;
  cooldownMs: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  hp: number;
  speed: number;
  slowMs: number;
  waypointIndex: number;
  x: number;
  y: number;
}

export interface Projectile {
  towerSite: number;
  targetId: number;
  x: number;
  y: number;
  damage: number;
  splash: boolean;
  slow: boolean;
}

export interface GardenSnapshot {
  mapId: number;
  wave: number;
  waveActive: boolean;
  coins: number;
  health: number;
  towers: TowerInstance[];
  enemies: Enemy[];
  projectiles: Projectile[];
  pending: EnemyKind[];
  spawnMs: number;
  speed: 1 | 2;
  rngState: number;
}

export class GardenDefenseSession {
  readonly rng: Rng;
  mapId = 0;
  wave = 0;
  waveActive = false;
  coins = 100;
  health = 20;
  towers: TowerInstance[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pending: EnemyKind[] = [];
  spawnMs = 0;
  speed: 1 | 2 = 1;
  selectedSite: number | null = null;
  buildMenuOpen = false;
  won = false;
  lost = false;
  private rewardGiven = false;
  private nextId = 1;

  constructor(seed: string | number = "garden-defense", mapId = 0, snapshot?: GardenSnapshot) {
    this.rng = new Rng(seed);
    this.mapId = mapId;
    if (snapshot !== undefined) this.applySnapshot(snapshot);
  }

  setSpeed(speed: 1 | 2): void {
    this.speed = speed;
  }

  openBuildMenu(site: number | null): void {
    this.selectedSite = site;
    this.buildMenuOpen = site !== null;
  }

  /** Atomic build: coins and site commit together or not at all. */
  buildTower(site: number, role: TowerRole): boolean {
    if (this.towers.some((tower) => tower.site === site)) return false;
    const cost = TOWERS[role].cost;
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.towers.push({ site, role, level: 1, cooldownMs: 0 });
    this.buildMenuOpen = false;
    return true;
  }

  upgradeTower(site: number): boolean {
    const tower = this.towers.find((candidate) => candidate.site === site);
    if (tower === undefined || tower.level >= 3) return false;
    const cost = 25 * tower.level;
    if (this.coins < cost) return false;
    this.coins -= cost;
    tower.level = (tower.level + 1) as 1 | 2 | 3;
    return true;
  }

  /** Selling removes the tower and any of its delayed projectiles. */
  sellTower(site: number): void {
    this.towers = this.towers.filter((tower) => tower.site !== site);
    this.projectiles = this.projectiles.filter((projectile) => projectile.towerSite !== site);
  }

  startWave(): void {
    if (this.waveActive || this.wave >= WAVE_COUNT) return;
    this.wave += 1;
    this.pending = this.waveQueue();
    this.spawnMs = 0;
    this.waveActive = true;
    this.rewardGiven = false;
  }

  private waveQueue(): EnemyKind[] {
    const queue: EnemyKind[] = [];
    const count = 6 + this.wave * 2 + this.mapId;
    for (let i = 0; i < count; i += 1) {
      const roll = this.rng.int(10);
      queue.push(roll >= 8 ? "beetle" : roll >= 4 ? "moth" : "bug");
    }
    return queue;
  }

  advance(deltaMs: number): void {
    if (!this.waveActive || this.lost || this.won) return;
    const step = Math.min(Math.max(0, deltaMs), 250) * this.speed;
    this.spawnMs += step;
    while (this.pending.length > 0 && this.spawnMs >= 1100) {
      this.spawnMs -= 1100;
      const kind = this.pending.shift() as EnemyKind;
      const origin = pathForMap(this.mapId)[0];
      this.enemies.push({
        id: this.nextId++, kind, hp: ENEMIES[kind].hp, speed: ENEMIES[kind].speed,
        slowMs: 0, waypointIndex: 0, x: origin.x, y: origin.y,
      });
    }

    const path = pathForMap(this.mapId);
    for (const enemy of this.enemies) {
      const target = path[enemy.waypointIndex + 1];
      if (target === undefined) continue;
      const effectiveSpeed = enemy.slowMs > 0 ? enemy.speed * 0.5 : enemy.speed;
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const length = Math.hypot(dx, dy) || 1;
      const travel = effectiveSpeed * (step / 1000);
      if (travel >= length) {
        enemy.x = target.x; enemy.y = target.y; enemy.waypointIndex += 1;
      } else {
        enemy.x += (dx / length) * travel; enemy.y += (dy / length) * travel;
      }
      enemy.slowMs = Math.max(0, enemy.slowMs - step);
    }

    for (const tower of this.towers) {
      tower.cooldownMs = Math.max(0, tower.cooldownMs - step);
      if (tower.cooldownMs > 0) continue;
      const spec = TOWERS[tower.role];
      const site = sitesForMap(this.mapId)[tower.site];
      const target = [...this.enemies].sort((a, b) => a.id - b.id).find(
        (enemy) => Math.hypot(enemy.x - site.x, enemy.y - site.y) <= spec.range * tower.level,
      );
      if (target === undefined) continue;
      tower.cooldownMs = spec.cooldownMs;
      this.projectiles.push({
        towerSite: tower.site, targetId: target.id, x: site.x, y: site.y,
        damage: spec.damage * tower.level,
        splash: tower.role === "splash",
        slow: tower.role === "slow",
      });
    }

    for (const projectile of [...this.projectiles]) {
      const target = this.enemies.find((enemy) => enemy.id === projectile.targetId);
      if (target === undefined) {
        this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
        continue;
      }
      const dx = target.x - projectile.x;
      const dy = target.y - projectile.y;
      const length = Math.hypot(dx, dy) || 1;
      const travel = 8 * (step / 1000);
      if (travel >= length) {
        this.applyHit(projectile, target);
        this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
      } else {
        projectile.x += (dx / length) * travel;
        projectile.y += (dy / length) * travel;
      }
    }

    const end = path[path.length - 1];
    for (const enemy of [...this.enemies]) {
      if (enemy.waypointIndex >= path.length - 1 && Math.hypot(enemy.x - end.x, enemy.y - end.y) < 0.05) {
        this.enemies.splice(this.enemies.indexOf(enemy), 1);
        this.health -= 1;
        if (this.health <= 0) this.lost = true;
      }
    }

    if (this.pending.length === 0 && this.enemies.length === 0 && !this.rewardGiven) {
      this.rewardGiven = true;
      this.coins += 60 + this.wave * 10;
      this.waveActive = false;
      if (this.wave >= WAVE_COUNT) this.won = true;
    }
  }

  private applyHit(projectile: Projectile, target: Enemy): void {
    target.hp -= projectile.damage;
    if (projectile.slow) target.slowMs = 1200;
    if (projectile.splash) {
      for (const enemy of this.enemies) {
        if (enemy.id !== target.id && Math.hypot(enemy.x - target.x, enemy.y - target.y) <= 1.2) {
          enemy.hp -= Math.round(projectile.damage / 2);
        }
      }
    }
    for (const enemy of [...this.enemies]) {
      if (enemy.hp <= 0) {
        this.coins += ENEMIES[enemy.kind].bounty;
        this.enemies.splice(this.enemies.indexOf(enemy), 1);
      }
    }
  }

  snapshot(): GardenSnapshot {
    return {
      mapId: this.mapId,
      wave: this.wave,
      waveActive: this.waveActive,
      coins: this.coins,
      health: this.health,
      towers: this.towers.map((tower) => ({ ...tower })),
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      projectiles: this.projectiles.map((projectile) => ({ ...projectile })),
      pending: [...this.pending],
      spawnMs: this.spawnMs,
      speed: this.speed,
      rngState: this.rng.getState(),
    };
  }

  applySnapshot(snapshot: GardenSnapshot): void {
    validateSnapshot(snapshot);
    this.mapId = snapshot.mapId;
    this.wave = snapshot.wave;
    this.waveActive = snapshot.waveActive;
    this.coins = snapshot.coins;
    this.health = snapshot.health;
    this.towers = snapshot.towers.map((tower) => ({ ...tower }));
    this.enemies = snapshot.enemies.map((enemy) => ({ ...enemy }));
    this.projectiles = snapshot.projectiles.map((projectile) => ({ ...projectile }));
    this.pending = [...snapshot.pending];
    this.spawnMs = snapshot.spawnMs;
    this.speed = snapshot.speed;
    this.rng.setState(snapshot.rngState);
    this.won = this.wave >= WAVE_COUNT && !this.waveActive;
    this.lost = this.health <= 0;
    this.rewardGiven = false;
    this.nextId = Math.max(1, ...this.enemies.map((enemy) => enemy.id + 1));
  }
}

export const SAVE_FORMAT = "ksu.game.save";
export const SAVE_APP_ID = "garden-defense";

export class SaveError extends Error {
  constructor(reason: string) {
    super(`garden-defense save rejected: ${reason}`);
    this.name = "SaveError";
  }
}

export function encodeSave(session: GardenDefenseSession): string {
  return JSON.stringify({
    format: SAVE_FORMAT, schemaVersion: 1, appId: SAVE_APP_ID, kind: "logical-snapshot",
    gameBuild: "rules-1", contentVersion: "1", payload: session.snapshot(),
  });
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

export function validateSnapshot(payload: GardenSnapshot): void {
  if (!payload || !integer(payload.mapId, 0, 2) || !integer(payload.wave, 0, WAVE_COUNT) ||
      typeof payload.waveActive !== "boolean" || !integer(payload.coins) || !integer(payload.health, 0, 20) ||
      !Array.isArray(payload.towers) || payload.towers.length > SITE_COUNT ||
      !Array.isArray(payload.enemies) || payload.enemies.length > 400 ||
      !Array.isArray(payload.projectiles) || payload.projectiles.length > 200 ||
      !Array.isArray(payload.pending) || payload.pending.length > 40 ||
      !finite(payload.spawnMs) || payload.spawnMs < 0 || payload.spawnMs >= 1100 ||
      ![1, 2].includes(payload.speed) || !integer(payload.rngState, 1, 0xffffffff)) {
    throw new SaveError("invalid checkpoint fields");
  }
  const towerSites = new Set<number>();
  for (const tower of payload.towers) {
    if (!integer(tower.site, 0, SITE_COUNT - 1) || towerSites.has(tower.site) ||
        !(tower.role in TOWERS) || !integer(tower.level, 1, 3) || !integer(tower.cooldownMs, 0, 900)) {
      throw new SaveError("invalid tower");
    }
    towerSites.add(tower.site);
  }
  const enemyIds = new Set<number>();
  for (const enemy of payload.enemies) {
    if (!integer(enemy.id, 1) || enemyIds.has(enemy.id) || !(enemy.kind in ENEMIES) ||
        !finite(enemy.hp) || enemy.hp <= 0 || !finite(enemy.speed) || enemy.speed <= 0 ||
        !finite(enemy.slowMs) || enemy.slowMs < 0 || !integer(enemy.waypointIndex, 0, 5) ||
        !finite(enemy.x) || !finite(enemy.y)) {
      throw new SaveError("invalid enemy");
    }
    enemyIds.add(enemy.id);
  }
  for (const projectile of payload.projectiles) {
    if (!integer(projectile.towerSite, 0, SITE_COUNT - 1) || !integer(projectile.targetId, 1) ||
        !finite(projectile.x) || !finite(projectile.y) || !finite(projectile.damage) || projectile.damage <= 0 ||
        typeof projectile.splash !== "boolean" || typeof projectile.slow !== "boolean") {
      throw new SaveError("invalid projectile");
    }
  }
  if (payload.pending.some((kind) => !(kind in ENEMIES))) throw new SaveError("invalid wave queue");
  if (payload.health <= 0 && payload.waveActive) throw new SaveError("defeated garden cannot have an active wave");
}

export function decodeSave(text: string, maxBytes = 8 * 1024 * 1024): { payload: GardenSnapshot } {
  if (text.length > maxBytes) throw new SaveError("document exceeds the size limit");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new SaveError("document is not valid JSON"); }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== SAVE_FORMAT || envelope.schemaVersion !== 1 || envelope.appId !== SAVE_APP_ID ||
      envelope.kind !== "logical-snapshot" || envelope.gameBuild !== "rules-1" ||
      envelope.contentVersion !== "1" || typeof envelope.payload !== "object" || envelope.payload === null) {
    throw new SaveError("wrong envelope");
  }
  const payload = envelope.payload as GardenSnapshot;
  validateSnapshot(payload);
  return { payload };
}

export function sessionFromSave(envelope: { payload: GardenSnapshot }): GardenDefenseSession {
  return new GardenDefenseSession("restore", envelope.payload.mapId, envelope.payload);
}
