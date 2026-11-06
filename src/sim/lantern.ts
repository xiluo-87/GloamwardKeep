import { BOSS, DARK_DAMAGE, FLAME, POST, WICK } from '../data/balance';
import { hashCell } from './rng';
import { emit, Flame, Input, passiveRank, Post, RunState } from './state';

export const flameRadius = (flame: Flame, wick: number, bonus: number, cap: number): number =>
  Math.min(cap, flame === 'burning' ? FLAME.burning.radius + wick * WICK.radius + bonus : FLAME[flame].radius);

export const flameBurn = (flame: Flame, wick: number, burnMul: number): number =>
  (flame === 'burning' ? FLAME.burning.burn + wick * WICK.burn : FLAME[flame].burn) * burnMul;

export const flameDamage = (flame: Flame, wick: number): number =>
  flame === 'burning' ? FLAME.burning.damage + wick * WICK.damage : FLAME[flame].damage;

export const flameSpawn = (flame: Flame, wick: number): number =>
  flame === 'burning' ? FLAME.burning.spawn + wick * WICK.spawn : FLAME[flame].spawn;

/** The whole damage rule: flame state, wick, darkness and the late-game exception on the final foe. */
export function finalDamage(base: number, o: { flame: Flame; wick: number; inLight: boolean; inverted: boolean }): number {
  if (o.inverted) return base * (o.flame === 'dimmed' ? BOSS.invDim : BOSS.invBurn);
  return base * flameDamage(o.flame, o.wick) * (o.inLight ? 1 : DARK_DAMAGE);
}

export const isInverted = (s: RunState): boolean => s.boss?.phase === 3 && !s.bossDead;

export function addOil(s: RunState, amount: number): void {
  const p = s.player;
  p.oil = Math.min(p.maxOil, p.oil + amount);
}

export function drainOil(s: RunState, amount: number): void {
  if (isInverted(s)) return;
  s.player.oil = Math.max(0, s.player.oil - amount);
}

export function updateLantern(s: RunState, input: Input, dt: number): void {
  const p = s.player;
  const wick = passiveRank(s, 'wick');
  const inverted = isInverted(s);
  const wasDim = s.flame === 'dimmed';
  s.flame = p.oil <= 0 ? 'guttering' : input.dim ? 'dimmed' : 'burning';
  if (s.flame === 'dimmed' && !wasDim && s.boss) s.boss.dimFlicker = BOSS.dimFlicker;
  if (!inverted) p.oil = Math.max(0, p.oil - flameBurn(s.flame, wick, p.burnMul) * dt);
  if (s.flame === 'guttering') {
    p.hp -= FLAME.gutterHpLoss * dt;
    p.hurt = Math.max(p.hurt, 0.05);
    s.stats.gutterTime += dt;
    if (!s.gutterSeen) { s.gutterSeen = true; emit(s, 'gutter'); }
  } else s.gutterSeen = false;
  const target = s.bossDead ? 0 : flameRadius(s.flame, wick, s.lightBonus, s.lightCap);
  // Exponential ease that closes about 95% of the gap in FLAME.easeTime, so the light breathes.
  s.radius += (target - s.radius) * (1 - Math.exp((-dt * 3) / FLAME.easeTime));
  s.dmgMul = flameDamage(s.flame, wick);
  s.stats.oilMin = Math.min(s.stats.oilMin, p.oil);
  s.stats.oilSum += p.oil / p.maxOil;
  s.stats.oilSamples++;
}

const postKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

export function postAt(s: RunState, cx: number, cy: number): Post {
  const key = postKey(cx, cy);
  let post = s.posts.get(key);
  if (!post) {
    const jx = hashCell(s.cfg.seed, cx, cy);
    const jy = hashCell(s.cfg.seed + 77, cx, cy);
    post = { x: (cx + 0.2 + jx * 0.6) * POST.spacing, y: (cy + 0.2 + jy * 0.6) * POST.spacing, life: 0, progress: 0 };
    s.posts.set(key, post);
  }
  return post;
}

export const postRadius = (post: Post): number => (POST.radius * post.life) / POST.life;
export const postCost = (s: RunState): number => POST.cost * s.postCostMul;

export function updatePosts(s: RunState, dt: number): void {
  const p = s.player;
  s.activePost = null;
  const pcx = Math.floor(p.x / POST.spacing);
  const pcy = Math.floor(p.y / POST.spacing);
  const cost = postCost(s);
  for (let cy = pcy - 1; cy <= pcy + 1; cy++) {
    for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
      const post = postAt(s, cx, cy);
      const d = Math.hypot(post.x - p.x, post.y - p.y);
      if (post.life <= 0 && d <= POST.lightDist && p.oil >= cost && !s.bossDead) {
        s.activePost = post;
        post.progress += dt;
        if (post.progress >= POST.lightTime) {
          post.progress = 0;
          post.life = POST.life;
          p.oil -= cost;
          s.litPosts.push(post);
          emit(s, 'post', post.x, post.y);
        }
      } else if (post.life <= 0) post.progress = 0;
    }
  }
  for (let i = s.litPosts.length - 1; i >= 0; i--) {
    const post = s.litPosts[i];
    post.life -= dt;
    if (post.life <= 0) {
      post.life = 0;
      s.litPosts.splice(i, 1);
    }
  }
}

export function snuffPost(s: RunState, post: Post, amount: number): void {
  post.life = Math.max(0, post.life - amount);
  // updatePosts removes the post from the lit list on the next step.
  emit(s, 'post', post.x, post.y, 1);
}

/** Tags every enemy with whether it stands in the light, and in a lamppost's light in particular. */
export function classifyLight(s: RunState): void {
  const p = s.player;
  const r2 = s.radius * s.radius;
  const posts = s.litPosts;
  const lights = s.litSentries;
  for (let i = 0; i < s.enemies.count; i++) {
    const e = s.enemies.items[i];
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    let lit = dx * dx + dy * dy <= r2;
    let inPost = false;
    for (let j = 0; j < posts.length; j++) {
      const post = posts[j];
      const pr = postRadius(post);
      const ax = e.x - post.x;
      const ay = e.y - post.y;
      if (ax * ax + ay * ay <= pr * pr) { lit = true; inPost = true; break; }
    }
    if (!lit) {
      for (let j = 0; j < lights.length; j++) {
        const l = lights[j];
        const ax = e.x - l.x;
        const ay = e.y - l.y;
        if (ax * ax + ay * ay <= 6400) { lit = true; break; }
      }
    }
    e.inLight = lit;
    e.inPost = inPost;
  }
}
