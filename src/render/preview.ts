// Map selection preview stays on its own 2D canvas, regardless of the game renderer.
import { boardHeight, boardWidth, tileCenter } from '../sim/hex';
import type { Terrain } from '../sim/mapgen';
import { drawKeepSprite } from './keep';
import { blitBake, LIFT, TOP_MARGIN } from './terrain';

export function drawPreview(ctx: CanvasRenderingContext2D, terrain: Terrain, w: number, h: number): void {
  const ww = boardWidth(terrain.cols);
  const wh = boardHeight(terrain.rows) + TOP_MARGIN;
  const k = Math.min(w / ww, h / wh);
  const ox = (w - ww * k) / 2;
  const oy = (h - wh * k) / 2 + TOP_MARGIN * k;
  const dprc = ctx.getTransform().a || 1;
  blitBake(ctx, terrain, ox, oy, k, k * dprc);
  const gp = tileCenter(terrain.goal[0], terrain.goal[1]);
  ctx.save();
  ctx.translate(ox + gp.x * k, oy + (gp.y - terrain.height[terrain.goal[1] * terrain.cols + terrain.goal[0]] * LIFT) * k);
  ctx.scale(k, k);
  drawKeepSprite(ctx, 1, 0);
  ctx.restore();
}
