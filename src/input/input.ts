import type { Input } from '../sim/state';

/** Keyboard and touch both feed one Input object, so a controller could be added here later. */
export class Controls {
  readonly state: Input = { mx: 0, my: 0, dim: false };
  private keys = new Set<string>();
  private moveId: number | null = null;
  private dimId: number | null = null;
  joystick: { x: number; y: number; dx: number; dy: number } | null = null;
  onKey: (key: string) => void = () => undefined;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['F3', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.onKey(e.key);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.moved(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
  }

  clear(): void {
    this.keys.clear();
    this.moveId = null;
    this.dimId = null;
    this.joystick = null;
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    if (e.clientX < window.innerWidth / 2) {
      this.moveId = e.pointerId;
      this.joystick = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    } else {
      this.dimId = e.pointerId;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  private moved(e: PointerEvent): void {
    if (e.pointerId !== this.moveId || !this.joystick) return;
    const dx = (e.clientX - this.joystick.x) / 46;
    const dy = (e.clientY - this.joystick.y) / 46;
    const m = Math.hypot(dx, dy);
    const k = m > 1 ? 1 / m : 1;
    this.joystick.dx = dx * k;
    this.joystick.dy = dy * k;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.moveId) { this.moveId = null; this.joystick = null; }
    if (e.pointerId === this.dimId) this.dimId = null;
  }

  poll(): Input {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (this.joystick) { mx = this.joystick.dx; my = this.joystick.dy; }
    this.state.mx = mx;
    this.state.my = my;
    this.state.dim = k.has('Space') || this.dimId !== null;
    return this.state;
  }
}
