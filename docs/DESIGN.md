# Gloamward: game design

All numbers are starting values to tune through playtesting. Distances are in world pixels at 1x zoom, and times are in seconds unless stated.

## 1. Pillars

1. **The light is the game.** Every major decision should touch the lantern: how big, how long, and where.
2. **Greed against safety.** The strongest play is always a little more dangerous than the comfortable one.
3. **Readable chaos.** With 1,000 enemies on screen, the player can still see themselves, the threats and the oil.
4. **Moody, not grim.** A warm little light against a big soft dark, closer to a storybook than to horror.

## 2. Core loop

Move → weapons fire automatically → kills drop embers and oil → embers fill the level bar → choose 1 of 3 upgrades → the night gets harder → repeat until dawn or death.

Wax earned in each run buys permanent upgrades between runs.

## 3. Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD or arrow keys | Left-side floating joystick |
| Dim the lantern (hold) | Space | Hold the right side of the screen |
| Choose upgrade | 1, 2, 3 or click | Tap |
| Pause | Esc or P | Pause button |

There is no aim button. Weapons choose their own targets.

## 4. The lantern

### 4.1 Player stats

| Stat | Start |
|---|---|
| HP | 100 |
| Move speed | 150 px/s |
| Max oil | 100 |
| Starting oil | 70 |
| Pickup range | 60 px |

### 4.2 Flame states

| State | Light radius | Oil burn | Weapon damage | Spawn rate |
|---|---|---|---|---|
| Burning, Wick rank 0 | 220 | 1.0/s | ×1.00 | ×1.00 |
| Dimmed (hold Space) | 90 | 0.2/s | ×0.70 | ×0.80 |
| Guttering (oil at 0) | 50 | none | ×0.50 | ×1.00 |

While guttering the player loses 4 HP/s. Any oil pickup relights the lantern immediately. Radius changes ease over 0.25 s so the light breathes instead of snapping.

### 4.3 Wick rank

*Turn Up the Wick* is an upgrade with 5 ranks. Each rank adds:

- +30 light radius
- +8% weapon damage
- +0.35 oil/s burn
- +8% spawn rate

At rank 5 that is radius 370, ×1.40 damage, 2.75 oil/s and ×1.40 spawns. Dimming still uses the fixed values in the table above, so a high wick makes the dim button more valuable.

### 4.4 Darkness

Being "in the light" means an enemy's centre is inside the player's light radius or a lit lamppost's radius.

- Enemies in the dark take **×0.4 damage**.
- They are drawn only as a pair of faint eyes, which keeps threats fair but unsettling.
- Pickups in the dark glow faintly so the player can always find them.
- Weapons may target enemies in the dark, but prefer the nearest enemy in the light.

### 4.5 Oil sources

| Source | Oil |
|---|---|
| Droplet from a kill (common enemies, 6% chance) | +4 |
| Flask from an elite (always) | +25 |
| Flask from a supply crate (one spawns every 90 s, off-screen) | +25 |

**Kills inside a lamppost's light drop no oil.** They still drop embers.

## 5. Lampposts

Lampposts are scattered about 700 px apart across the map.

| Property | Value |
|---|---|
| Light cost | 10 oil |
| Light time | Stand within 40 px for 1.0 s |
| Light radius | 180, shrinking evenly to 0 |
| Lifetime | 45 s. It can be relit once it is out, at the same cost |

A lit post damages nothing by itself. It lets the player fight at full damage, gives a safe view of the surroundings and allows dimming without going blind. Snuffers will attack lit posts and shorten their lifetime.

## 6. Run structure

The run lasts 15:00. The sky gradient at the edge of the darkness moves from dusk violet to deep night and then to a grey-pink dawn.

| Time | Phase | New threats |
|---|---|---|
| 0:00 | Dusk | Soot Mites |
| 2:00 | Early night | Hollow Ones |
| 4:00 | | First elite wave, then one every 2:00 |
| 5:00 | Night | Snuffers |
| 8:00 | Deep night | Shade Hounds |
| 11:00 | The small hours | Mixed waves and encircling rings |
| 14:00 | Last dark | The Long Night (boss); normal spawns reduced by 70% |
| 15:00 | Dawn | Automatic win if the boss is dead; otherwise it continues until it is |

Spawn budget per second starts at 2 and grows linearly to 40 by 13:59. Spawns appear just outside the view. The simultaneous enemy cap is 1,000; when it is reached, the furthest common enemy is recycled.

## 7. Levelling

- Level *n* needs `5 + 4n + 0.4n²` embers, rounded down.
- Embers are worth 1 (common), 5 (tough) or 25 (elite).
- A level-up pauses the game and shows 3 choices.
- Choices come from weapons not yet owned, ranks of owned weapons, passives and any available combination.
- One reroll per run to begin with; more can be bought with wax.
- When everything is maxed out, choices become +20 HP or +20 oil.

## 8. Weapons

Six slots. Each weapon has 5 ranks. Rank bonuses are +20% damage per rank, plus the listed special bonus at ranks 3 and 5.

| Weapon | Behaviour | Damage | Cooldown | Rank 3 | Rank 5 |
|---|---|---|---|---|---|
| Moth Swarm | 3 moths orbit at 70 px, hitting what they touch | 6 per hit | 0.5 per enemy | +1 moth | +2 moths |
| Cinder Toss | Arcs to a random enemy and burns the ground for 3 s | 14 + 5/s burn | 1.8 | +1 throw | Larger pool |
| Wick Lash | Short whip in the movement direction, with a wide arc | 18 | 1.0 | Hits behind too | +40% length |
| Glass Shards | A shard bounces between enemies | 9 per hit, 4 bounces | 1.4 | +2 bounces | +1 shard |
| Bell Toll | Expanding ring that damages and pushes back | 10 | 4.0 | +30% push | +25% radius |
| Candle Sentry | Places a turret at your feet, firing at the nearest enemy; lasts 12 s | 7 per shot, 2 shots/s | 8.0 | +1 sentry | Sentries give a small light of radius 80 |

### Combinations

When both weapons are at rank 5, the next level-up offers the combination. It replaces both and frees a slot.

| Pair | Result | Effect |
|---|---|---|
| Moth Swarm + Cinder Toss | **Firemoths** | Moths leave burning trails and dive at distant enemies |
| Wick Lash + Glass Shards | **Stained Lash** | The whip throws coloured shards along its whole length |
| Bell Toll + Candle Sentry | **The Vigil** | Sentries toll bells, and each toll adds lifetime to nearby lit lampposts |

## 9. Passives

Six slots, 5 ranks each.

| Passive | Per rank |
|---|---|
| Turn Up the Wick | See section 4.3 |
| Deep Reservoir | +20 max oil, and +10 oil once |
| Trimmed Wick | −8% oil burn |
| Good Boots | +7% move speed |
| Waxed Coat | −1 damage taken, minimum 1 |
| Ember Hook | +25% pickup range |
| Warm Heart | +20 max HP, and 0.2 HP/s regeneration |

## 10. Enemies

Damage is per touch, with a 0.5 s hit interval per enemy. After any hit the player has 0.35 s of grace in which further hits do nothing.

| Enemy | From | HP | Speed | Damage | Embers | Behaviour |
|---|---|---|---|---|---|---|
| Soot Mite | 0:00 | 8 | 70 | 4 | 1 | Swarms straight at the player |
| Hollow One | 2:00 | 45 | 40 | 10 | 5 | Slow and heavy; resists push by 50% |
| Snuffer | 5:00 | 20 | 110 | 3 | 1 | Flies to the nearest light. Touching the player drains 5 oil. Touching a post removes 5 s of its life and consumes the Snuffer, which drops nothing |
| Shade Hound | 8:00 | 30 | 170 | 8 | 5 | Fully invisible in the dark, with no eyes. Hunts in packs of 6 |
| Elite | 4:00 | ×12 | ×0.8 | ×2 | 25 | Larger version of the current toughest type, with a pale halo. Always drops a flask |

Enemy HP is multiplied by `1 + minutes / 6` at spawn time.

## 11. Boss: The Long Night

**Spoilers below.** The README stays quiet about this on purpose.

The Long Night is a tall figure of solid dark, with a ring of pale eyes and 6,000 HP.

| Phase | HP | Behaviour |
|---|---|---|
| 1. Tide | 100–60% | Walks slowly toward the player and sends waves of mites |
| 2. Eclipse | 60–25% | Shrinks the player's maximum light radius by 8 px/s, down to 70, and blows out lampposts it passes |
| 3. Inversion | 25–0% | **The rule flips.** See below |

### The Inversion

This is the game's one big surprise. Nothing in the game explains it directly.

When phase 3 begins, the lantern stutters, the music drops out, and the boss fades completely from the lit view. Its eyes close.

- While the lantern is **burning**, the boss cannot be seen and takes ×0.1 damage.
- While the lantern is **dimmed**, a burning core becomes visible in the boss's chest, and the boss takes ×2 damage. The dim damage penalty does not apply.
- Oil stops burning for the whole phase, so holding the dim button is always possible.
- The boss attacks with slow, telegraphed sweeps that are bright against the dark, so playing dim stays fair.

When the phase begins the eclipse lifts and the light returns to full size, so burning looks safe for the first time in minutes. If the lantern was out it relights with 10 oil. Oil cannot be drained during this phase, and the boss no longer hurts by touch. The boss has no leash limit: if the player gets far away it speeds up to close the distance.

The only hint is that the boss's core flickers visibly for a moment whenever the player's lantern dims. For the whole run the player has learned that light is safety; to finish the night they have to trust the dark.

Killing it plays the dawn at once, even if the clock has not reached 15:00: the darkness overlay fades over 4 s into pink-grey morning, enemies crumble to ash, and the lantern goes out on its own.

## 12. Between runs

**Wax** is earned at `5 per minute survived + 1 per 100 kills + 50 for reaching dawn`.

| Upgrade | Ranks | Effect per rank |
|---|---|---|
| Better Glass | 5 | +10 starting light radius |
| Full Flask | 5 | +5 starting oil |
| Sturdy Frame | 5 | +10 max HP |
| Second Thought | 3 | +1 reroll per run |
| Long Memory | 5 | +4% embers |

### Characters

| Character | Unlock | Starting weapon | Trait |
|---|---|---|---|
| The Lamplighter | Default | Wick Lash | Lampposts cost half the oil |
| The Chandler | Earn 300 wax in total | Candle Sentry | +30% wax earned |
| The Sexton | Reach 10:00 | Bell Toll | Toll of the bell pushes oil and embers toward you |
| The Moth Child | Reach dawn once | Moth Swarm | Radius −40, speed +15%, always 2 extra moths |

### New Moon mode

Unlocked by reaching dawn. Light radius is capped at 120, and everything else gives ×1.5 wax.

## 13. Look and sound

**Palette**

| Use | Colour |
|---|---|
| Night | `#0b0e1a` |
| Cobbles | `#1a2030`, `#232a3d` |
| Lantern glow | `#ffb347` to transparent |
| Embers | `#ff7a2f` |
| Oil | `#7ad7c2` |
| Danger accents | `#d94f6a` |
| Dawn | `#e8b7b0` |

**Style:** simple flat shapes drawn in code. Enemies are dark silhouettes that gain rim-light on the side facing the lantern. The town is an endless street pattern of cobbles, doors, fences and dead trees that decorate the world without colliding.

**Light rendering:** draw the world, then a darkness canvas filled with near-black, then cut holes with radial gradients using `destination-out`. Add warm glow on top with `lighter`. Render the darkness canvas at half resolution.

**Sound:** everything uses Web Audio, with no sample files:

- A soft drone that drops in pitch through the night
- A low heartbeat when oil is below 20
- Short filtered noise for hits, with a capped number of voices
- Pitch-varied plucks for pickups
- Bell tones for level-ups and the Bell Toll

## 14. Screens

Title → character choice → run → pause or level-up overlay → death or dawn summary → wax shop → title.

The HUD shows HP, an oil gauge shaped like the lantern reservoir, the ember bar, the clock and the weapon slots. When oil is low the gauge pulses and the screen edge darkens.

## 15. Out of scope for version 1

- Multiplayer and online leaderboards
- Accounts or any backend
- Collision with buildings
- Multiple maps
- Controller support, which can come later if the input layer stays clean
