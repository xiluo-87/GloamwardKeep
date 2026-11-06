# Gloamward

*You are the last lamplighter in a town swallowed by dusk. Keep the flame alive until dawn.*

Gloamward is a browser survivor game. You move, your weapons fire on their own, and the swarm keeps growing. Your lantern is what makes it different: its light is your sight, your damage and your clock, and it runs on oil you can only get by fighting.

**Status:** version 1 is built and playable from dusk to dawn. Balance has only been tested by a bot so far, so human playtesting comes next.

## The idea in four rules

1. **Light is power.** Enemies outside your light are almost invisible and take much less damage.
2. **Oil is time.** The lantern always burns oil, and most oil comes from kills.
3. **Bigger is riskier.** A bigger flame reaches further and hits harder, but it burns faster and draws more enemies. You can dim it to save oil.
4. **Safety doesn't pay.** Lampposts make safe pools of light, but kills inside them give no oil.

Survive 15 minutes, from dusk to dawn.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD or arrow keys | Left thumb |
| Dim the lantern | Hold Space | Hold the right side of the screen |
| Choose an upgrade | 1, 2, 3 or click | Tap |
| Reroll an upgrade | R | Tap |
| Pause | Esc or P | Pause button |

## Run it

```bash
npm install
```

```bash
npm run dev
```

`npm test`, `npm run lint` and `npm run build` are the checks. F3 or the backquote key shows FPS and entity counts.

Debug options go in the URL: `?debug&start=9&kit&speed=2&seed=5` starts at 9:00 with a full weapon kit, at double speed, on a fixed seed. Add `bot` to let the balance bot play. In debug mode `[` and `]` change speed, `N` skips a minute and `B` toggles the bot.

## Tech

TypeScript, Vite and Canvas 2D with no game engine and no backend. All art is drawn in code and all sound is generated with the Web Audio API. Hosted on GitHub Pages.

## Docs

- [Game design](docs/DESIGN.md): mechanics, content and starting balance numbers
- [CLAUDE.md](CLAUDE.md): build order and engineering rules for whoever writes the code
