# Gloamward

*You are the last lamplighter in a town swallowed by dusk. Keep the flame alive until dawn.*

Gloamward is a browser survivor game. You move, your weapons fire on their own, and the swarm keeps growing. Your lantern is what makes it different: its light is your sight, your damage and your clock, and it runs on oil you can only get by fighting.

**Status:** design only. No game code exists yet.

## The idea in four rules

1. **Light is power.** Enemies outside your light are almost invisible and take much less damage.
2. **Oil is time.** The lantern always burns oil, and most oil comes from kills.
3. **Bigger is riskier.** A bigger flame reaches further and hits harder, but it burns faster and draws more enemies. You can dim it to save oil.
4. **Safety doesn't pay.** Lampposts make safe pools of light, but kills inside them give no oil.

Survive 15 minutes, from dusk to dawn.

## Planned tech

TypeScript, Vite and Canvas 2D with no game engine and no backend. All art is drawn in code and all sound is generated with the Web Audio API. Hosted on GitHub Pages.

## Docs

- [Game design](docs/DESIGN.md): mechanics, content and starting balance numbers
- [CLAUDE.md](CLAUDE.md): build order and engineering rules for whoever writes the code
