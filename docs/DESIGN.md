# Gloamward Keep: game design

This document is the source of truth for how the game behaves. **`src/data/balance.ts` holds every number**, `src/data/text.ts` holds every name and description, and `src/sim/mapgen.ts` holds the map generator. If you change a mechanic or a value on purpose, update this document in the same commit. Distances are world pixels at 1x zoom and times are seconds unless stated. There is no story mode.

## 1. Pillars

1. **High ground is power.** Terrain has heights 0 to 4. A tower's range grows 12% per height level, so the best spots are on the hills above the road.
2. **Mazing is the strategy.** Enemies walk only on level 0, which is the road. You steer them by building walls and towers on it, so they take longer routes under your fire.
3. **Seal it and they smash.** If every route is blocked, enemies walk to the cheapest blocker and smash it. Sealing is a bet, not a cheat.
4. **Every map is new.** Maps are generated from a seed, so no two runs share a layout.
5. **Classic fantasy, readable at a glance.** Towers, heroes and enemies are drawn in code and sound comes from Web Audio.

## 2. Core loop

Build towers and place a hero with gold, call or wait for the next wave, earn gold from kills and wave bonuses, upgrade and fork towers, level the hero and learn skills, and hold the keep through 30 waves. Lives are lost when enemies reach the keep. After each run, profile XP unlocks heroes, perks and maps.

A run starts with 300 gold and 20 lives. The player starts the first wave; later waves start by themselves 14 seconds after the previous wave finished spawning, or sooner if called early.

## 3. Controls

| Action | Keyboard | Touch |
|---|---|---|
| Choose a tower to build | 1 to 7 | Tap a tower in the bar |
| Choose a hero to place | Q, W | Tap a hero in the bar |
| Place | Click a tile | Tap a tile to select, tap it again to place |
| Select a placed tower | Click it | Tap it |
| Call the next wave | Space | Call button |
| Upgrade (first or second option) | U, I | Panel buttons |
| Sell | S | Panel button |
| Change target mode | T | Panel button |
| Hero ability | A | Panel button |
| Cancel or pause | Esc | Back button |

Targeting modes cycle through first, last, strong and close.

## 4. Maps

### 4.1 Board

The board is a hex grid of 24 columns by 14 rows (pointy-top hexes, odd rows shifted right, hex radius 28 px). Every tile has a height from 0 to 4. Enemies walk only on height 0. Towers can stand on any height. The keep is on the right edge and the gates are on the left edge.

### 4.2 Presets

| Preset | Gates | Enemy HP | Profile XP | Unlock (profile level) | Character |
|---|---|---|---|---|---|
| Meadow | 1 | x1.0 | x1.0 | 1 | Gentle hills (maxStep 1), 4 to 6 roomy clearings, 22% forest |
| Highlands | 1 | x1.1 | x1.3 | 4 | Steeper (maxStep 2), more high ground, 1 to 2 clearings |
| Canyon | 2 | x1.2 | x1.6 | 8 | Rocky heights, mostly height 3 and 4, two gates that merge |

Share of off-road tiles at heights 1 to 4: Meadow 38/28/20/14%, Highlands 22/28/27/23%, Canyon 16/22/30/32%.

### 4.3 Generator rules

The same preset and map seed always give the same map. The generator retries with derived seeds (up to 200 attempts) until a map passes every check, then falls back to a flat road map that cannot fail.

1. **Heights.** Layered value noise is ranked by quantile, so each preset gets its share of heights 1 to 4. Neighbouring tiles differ by at most `maxStep` (terracing).
2. **Level 0 only on the road network.** The only level-0 tiles are the carved road, its clearings and the shortcut gaps. Any pocket cut off from the road is raised. Every level-0 tile is connected to the keep.
3. **Serpentine road.** The road is a series of 3 to 5 legs sweeping between the top and bottom of the board, so it winds past most of it. Turns happen within 15% of the top or bottom edge.
4. **Reach.** With shortcuts plugged, at least 2/3 of all tiles must lie within 2 hexes of the enemy route, and the shortest walk must be at least 22 tiles (Meadow, Canyon) or 26 (Highlands).
5. **Clearings.** At turns near the top and bottom edges, level-0 blobs of radius 1 to 2 give room for mazes (4 to 6 on Meadow, 1 to 2 elsewhere).
6. **Shortcut gaps.** Short level-0 channels (at most 3 tiles) are cut through the hills between two stretches of road, each saving enemies at least 10 hexes on Meadow and 12 elsewhere (1 to 3 on Meadow, 1 to 2 elsewhere). The player plugs them with towers or defends them. Reach and length checks are done on the road before the gaps are cut.
7. **Forest and rocks only on heights 1 to 4,** never on level 0. Forest grows in groves on low hills (heights 1 to 2 on Meadow and Canyon, 1 to 3 on Highlands). Rocks sit on high ground (heights 2 to 4) and are more common on cliff edges (a drop of 2 or more to a neighbour). Covered tiles cannot be built on until cleared (section 5.7).
8. **Canyon gates.** One gate sits in the top half of the left edge and one in the bottom half. Each has its own winding road, and the two roads merge at the middle of the board (50% of the width), then share one serpentine to the keep. Spawns alternate between the gates.
9. **The keep** sits on the right edge, at least 2 rows from the top and bottom.

## 5. Pathing, smashing and economy

### 5.1 Pathing

Enemies follow a flow field built outward from the keep over level-0 tiles. Every tile holds its walking cost to the keep, and tiles off the road cost Infinity. A tower on a level-0 tile adds 1000 to the cost of entering that tile, far more than any road. The field is rebuilt whenever a level-0 tower is built, sold or destroyed, and enemies re-pick their next tile at once.

Consequences:

- If another route exists, enemies walk around the tower, even if it is much longer.
- A tower on high ground never changes the field.
- Towers cannot be built on a road tile while a walking enemy stands on it.
- **Flyers (bats) ignore the terrain** and fly straight to the keep.

### 5.2 Smashing

When every route is sealed, enemies take the route with the fewest blockers and walk to the first blocking tower. They stop at its edge and deal their `attack` damage per second to it. Tower hit points are 120 + 1.2 per gold invested, plus the tower's `hp` stat (heroes: 500 + 60 per level above 1, plus `hp`). When a tower reaches 0 hit points it is destroyed (a hero can be placed again), the field is rebuilt and enemies continue. Spiked Walls hurt whatever smashes them (thorns). All towers repair to full hit points when a wave is cleared.

### 5.3 Gold

Gold is the only currency.

- **Kills** pay the enemy's gold, times the Bounty perk, times (1 + the sum of every placed tower's `bounty`).
- **Wave bonus** when a wave is cleared (all its enemies spawned and dead or leaked): `35 + 5 x wave`, plus Treasury income, plus interest (section 12).
- **Early call bonus**: calling the next wave while its countdown still runs pays `floor(seconds left x 2 x Eager multiplier)`. The first call pays nothing. A wave cannot be called while the current one is still spawning.
- **Sell refund**: `floor(gold invested x 0.7)` (0.9 with Salvage). Invested gold counts the build price, every upgrade and every skill.
- **Treasury** (Shrine fork B) pays gold per wave: +40, then +65.
- **Repairs** are free and happen on wave clear.

### 5.4 Lives and winning

Each leaking enemy costs its `lives` value (1 for most, 2 for orcs and wagons, 3 for trolls, 15 for the Ogre King, 20 for the Lich). At 0 lives the run is lost. Surviving wave 30 and killing everything wins. Clearing wave w pays profile XP (section 11).

### 5.5 Building rules

A tile can't be built on if it holds forest or rocks, the keep or a gate, or another tower. Building needs the gold. A hero must be in the run's loadout, and only one of each hero can stand at a time. A sold or destroyed hero can be placed again (at its start level; skills are lost).

### 5.6 Hit points of enemies

Enemy HP is multiplied by the map's HP multiplier and, for everything except bosses, by `waveHpScale(w) = 1 + 0.08 (w - 1) + 0.005 (w - 1)^2` (wave 10: x2.1, wave 20: x4.3, wave 30: x7.5).

### 5.7 Clearing forest and rocks

Paying gold removes the forest or rocks from a tile and makes it buildable. Price is `base x (1 + 0.25 x height) x costMul`, rounded, with base 35 for forest and 60 for rocks. Clearing a bare tile fails, as does clearing without enough gold. Cleared tiles stay cleared for the run, and the terrain version counter lets the renderer redraw them. Because forest and rocks only exist above level 0, clearing never changes enemy pathing.

## 6. Damage rules

- Three damage types: physical (reduced by **armour**), fire and magic (both reduced by **ward**).
- Armour minus accumulated **shred** is the physical resistance. Shred stacks per enemy up to 0.5 and never takes armour below 0.
- Resistances are capped at 0.8, so nothing is immune.
- **Shields** (from Orc Shamans) absorb damage after resistance and before hit points.
- **Stalkers** cannot be targeted unless a tower with detection (the Knight, or a Shrine from tier 3) covers them.
- **Flyers** can only be hit by towers with `hitsFlying`. Catapult splash and burning ground never hit flyers.
- **Jinx** (Hexers) multiplies the attack speed of towers within 64 px by 0.6 for 2.5 seconds. **Silence** (the Lich) stops attacks for 3.5 seconds.
- Bolts home on their target; lobs aim where the target will be; pulses hit everything in range; chains jump between enemies and lose strength per jump; the Arcane Beam holds one target and ramps up.
- Stunned enemies freeze. Bosses cannot be stunned or slowed.

## 7. Towers

Every tower is built, upgraded along two linear tiers, then forked into A or B with two more tiers each. A fork can't be switched. `src/data/text.ts` has the names. Costs below are build, tier 2, tier 3, then fork tier 1 and 2. Ranges are base values before height.

| Tower | Role | Build | Tiers (2, 3) | Fork A | Fork B | Base stats |
|---|---|---|---|---|---|---|
| Palisade | Cheap blocker, walls | 20 | Stone Wall 30, Fortified Wall 50 | Spiked Wall 90, Thorn Rampart 150 | Guard Wall 100, Battlements 170 | 4 dmg, 0.8/s, range 70, 80 hp |
| Archer Tower | Single target, hits flyers | 70 | Bowmen 75, Marksmen 130 | Longbow 240, Eagle Eye 400 | Volley 230, Arrow Storm 380 | 13 dmg, 1.25/s, range 150 |
| Catapult | Fire splash, ground only | 110 | Heavy Catapult 110, Siege Catapult 170 | Fire Pot 300, Inferno 460 | Scatter Shot 290, Hailstorm 440 | 22 dmg, 0.5/s, range 170, splash 46 |
| Frost Tower | Slowing pulse, ground only | 90 | Ice Spire 100, Winter Spire 150 | Deep Freeze 270, Glacier 410 | Shatter 250, Frostbite 400 | 10 magic, 0.45/s, range 105, 35% slow |
| Mage Tower | Chain lightning, hits flyers | 120 | Adept Tower 140, Wizard Tower 210 | Storm Spire 310, Tempest 470 | Arcane Beam 330, Sunfire 500 | 16 magic, 0.8/s, range 140, 2 jumps |
| Aviary | Hawks, hit flyers | 100 | Hawk Roost 100, Falconry 170 | Fire Hawks 290, Phoenix Roost 450 | War Eagles 310, Royal Eagles 470 | 2 hawks, 9 dmg, range 160 |
| Shrine | Aura, no attack | 80 | Blessed Shrine 100, Watch Shrine 150 | War Banner 260, Royal Standard 400 | Treasury 240, Royal Mint 380 | +10% damage to towers in range 150 |

What each upgrade does, from the data:

- **Palisade.** Tiers add hit points (+500, then +900), a little damage and, at tier 3, +20 range. Spiked Wall adds thorns 30 (then 50), damage and a slow. Guard Wall adds damage, speed, range and `hitsFlying`, then hit points.
- **Archer.** Tiers add damage and speed. Longbow: +120 range, +40 damage, slower, 15% crit; Eagle Eye adds damage, crit and 8% armour shred. Volley: +1 arrow, then another.
- **Catapult.** Fire Pot leaves burning ground (18 then 22 fire/s for 3 s) and bigger splash. Scatter Shot adds 4 then 3 cluster bursts at 45% damage.
- **Frost.** Deep Freeze adds a 25% then 15% chance to stun. Shatter adds damage and armour shred.
- **Mage.** Storm Spire adds 3 jumps and stronger jumps, then a second bolt. Arcane Beam is a held beam: damage x2 per second, ramping 0.6 per second up to x3 (x5 with Sunfire).
- **Aviary.** Fire Hawks set targets alight (14 then 26 burn/s). War Eagles hit hard and break armour, and Royal Eagles can stun.
- **Shrine.** Tier 2 +25 range and +5% damage. Tier 3 adds detection. War Banner adds range, damage and attack speed, and Royal Standard makes towers jinx-immune. Treasury pays gold per wave.

Tower hit points are mostly irrelevant unless the road is sealed.

## 8. Heroes

- Heroes are unique towers: one of each, and a run's loadout has 1 slot (2 from profile level 12).
- They are built with gold like towers, stand on any height, and can be smashed like any road tower.
- They level from XP: `heroXpNeed(level) = 12 + 12 level + 3 level^2`. Level 10 is the cap. A hero gets full XP for its own kills and 30% of the XP of every other kill. Veterans start heroes at level 3. XP comes from enemy `xp` times the Tutor perk.
- Each level adds stats (Knight +4 damage, Cleric +3 damage and +3 range, Sorcerer +5 damage, Ranger +2 damage and +0.05 speed, Druid +2 damage and +0.25 hawks).
- **Skill tree.** Three branches of four nodes. Node n of a branch needs hero level 1, 3, 5 and 8, needs the previous node of its branch, and costs 90, 170, 280 or 450 gold (before thrift). Node 4 of a branch is a capstone, and only one capstone may be learned per hero. Skills are paid with gold and count as invested gold for selling.
- **Abilities** have a cooldown (reduced by skills, never below 5 seconds) and start on a 10 second delay when the hero is placed. Use with A.

| Hero | Unlock level | Cost | Type | Ability | Branches |
|---|---|---|---|---|---|
| The Knight | 1 | 120 | Melee cleave (3 targets), detects stalkers, hits flyers | Charge: 120 damage and 1.5 s stun in radius 160, 40 s cooldown | Blade, Banner, Spoils |
| The Cleric | 3 | 130 | Slowing holy pulse, hits flyers | Sanctify: 60 magic damage and 2.5 s stun in radius 220, 45 s | Stillness, Wrath, Sanctuary |
| The Sorcerer | 6 | 140 | Chain lightning (3 jumps) | Arcane Barrage: 320 damage to the 8 strongest enemies in 1.5 x range, 35 s | Storm, Focus, Echo |
| The Ranger | 10 | 130 | Rapid arrows, +8% attack speed to towers in range | Rally: every tower attacks 50% faster for 8 s, 50 s | Bow, Captain, Hunter |
| The Druid | 15 | 140 | 4 hawks, range 200 | Wild Hunt: 16 temporary hawks for 10 s, 45 s | Flock, Flame, Talon |

Stunning does not affect bosses. Branch names and node names are in `text.ts`. Hero branches range from damage (Blade, Bow, Storm, Focus), through support (Banner, Captain, Stillness, Sanctuary), to gold (Spoils, Hunter: bounty and income).

## 9. Enemies

| Enemy | HP | Speed | Armour | Ward | Gold | Lives | XP | Special |
|---|---|---|---|---|---|---|---|---|
| Goblin | 34 | 52 | 0 | 0 | 5 | 1 | 1 | Small and many |
| Goblin Hexer | 55 | 84 | 0 | 0.2 | 7 | 1 | 2 | Jinxes towers within 64 px (attack speed x0.6 for 2.5 s) |
| Orc Warrior | 190 | 36 | 0.35 | 0 | 15 | 2 | 4 | Armoured, smashes at 30/s |
| Shadow Stalker | 95 | 108 | 0 | 0 | 11 | 1 | 3 | Stealth: needs detection |
| Giant Bat | 62 | 74 | 0 | 0 | 7 | 1 | 2 | Flies straight to the keep |
| Troll | 540 | 26 | 0.2 | 0.45 | 32 | 3 | 8 | Resists fire and magic, smashes at 70/s |
| War Wagon | 270 | 34 | 0.1 | 0 | 18 | 2 | 6 | Spills 5 goblins on death |
| Orc Shaman | 140 | 44 | 0 | 0.3 | 17 | 1 | 4 | Every 4 s shields allies within 95 px for 45 HP (up to 60% of their max) |
| The Ogre King (boss) | 6500 | 20 | 0.3 | 0.3 | 300 | 15 | 120 | Sheds 6 goblins at every 10% of HP lost; smashes at 250/s |
| The Lich (boss) | 17000 | 18 | 0.25 | 0.25 | 0 | 20 | 300 | Every 9 s silences towers within 200 px for 3.5 s; every 6 s raises 4 stalkers |

Speeds are pixels per second (a hex is about 48 px wide). Each enemy's `attack` is its smashing damage per second: goblin 10, hexer 12, orc 30, stalker 18, bat 8, troll 70, wagon 30, shaman 14.

## 10. Waves

There are 30 waves, defined as groups of `[enemy, count, seconds between spawns, start delay]` that run in parallel. Spawns alternate between gates on two-gate maps. Highlights:

- Waves 1 to 4: goblins, then the first hexers and orcs.
- Wave 7: bats arrive. Wave 8: stalkers, so build detection.
- Wave 9: shamans. Wave 10: war wagons.
- Wave 12: the first trolls.
- Wave 15: **The Ogre King** with goblins and hexers.
- Waves 16 to 29: mixes of everything, rising in numbers. Wave 21 sends 60 goblins in 12 seconds. Wave 29 is 16 trolls, 12 wagons, 12 shamans and 30 hexers.
- Wave 30: **The Lich** with stalkers, trolls and bats.

The next wave starts 14 seconds after the current one finishes spawning, whether or not enemies remain. Total enemies alive are capped at 600.

## 11. Profile XP and levels

Nothing is spent. Level is derived from total XP, so there is nothing to lose.

- XP for clearing wave w: `6 + w`. Winning adds 150. The total is multiplied by the map's XP multiplier (1, 1.3, 1.6) and rounded.
- XP to go from level L to L+1: `profileXpNeed(L) = 80 + 40 L + 6 L^2` (126 for level 1 to 2, 1,080 for 10 to 11). The maximum level is 25.
- A full 30-wave Meadow win is worth 150 + sum of (6 + w) for 1 to 30 = 150 + 180 + 465 = 795 XP.

### Unlocks by level

| Level | Unlock |
|---|---|
| 1 | The Knight, Meadow |
| 2 | Full Purse, first perk slot |
| 3 | The Cleric, Thick Walls |
| 4 | Highlands, Thrift |
| 5 | Salvage, second perk slot |
| 6 | The Sorcerer, Eagle Eye |
| 7 | Veterans |
| 8 | Canyon |
| 9 | Bounty, third perk slot |
| 10 | The Ranger |
| 11 | Eager |
| 12 | Second hero slot |
| 13 | Whetstone |
| 14 | Fourth perk slot |
| 15 | The Druid |
| 16 | Tutor |
| 18 | Interest |
| 21 | High Ground |

The loadout (up to the slot count) is chosen on the title screen. A profile that violates the unlock or slot rules is repaired on load.

## 12. Perks

| Perk | Level | Effect |
|---|---|---|
| Full Purse | 2 | +70 starting gold |
| Thick Walls | 3 | +6 lives |
| Thrift | 4 | Towers, upgrades, skills, heroes and clearing cost 8% less |
| Salvage | 5 | Selling refunds 90% |
| Eagle Eye | 6 | All towers x1.08 range |
| Veterans | 7 | Heroes start at level 3 |
| Bounty | 9 | Kills give 12% more gold |
| Eager | 11 | Early-call bonus x2.5 |
| Whetstone | 13 | All damage +8% (towers, heroes and abilities) |
| Tutor | 16 | Heroes gain 35% more XP |
| Interest | 18 | After each wave, 5% of banked gold, up to 60 |
| High Ground | 21 | +0.04 range per height level (0.16 instead of 0.12) |

## 13. Saves

The profile is stored in `localStorage` under the versioned key `gloamward-keep.save.v1`: total XP, perks, heroes, chosen map, per-map best wave and wins, run count, mute and reduce-motion. Loading survives missing, corrupt or odd data by falling back to defaults field by field, and a storage that throws.

## 14. Balance checks

- Balance has only been tested with the bot in `src/sim/bot.ts` (`tests/smoke.test.ts` runs it on every map). It plugs shortcut gaps, builds on high ground near the road, upgrades and levels one hero. At the time of writing it loses around wave 28 on Meadow and Highlands and around wave 13 on Canyon, which is a bot limit, not a verdict.
- Debug URL parameters: `?debug` shows FPS and entity counts and enables speed keys, `&bot` lets the bot play, `&wave=N` skips to wave N (with gold to match), `&map=canyon&mapseed=5` fixes the map, `&seed=N` fixes gameplay randomness.
- Things to check first when playtesting: how tight gold is through waves 1 to 10, whether the 14 second wave gap and the early-call bonus make calling early worth the risk, whether Palisade mazing beats pure tower building, whether stalkers on wave 8 feel fair without a detector, and how the Canyon plays with two gates.
- Healthy numbers: a decent player should end wave 10 with several upgraded towers on high ground and hold 20 lives through wave 15. If sealing the road is always right, smashing is too slow; if it is never right, smashing is too fast.

## 15. Future work

A 3D renderer with Three.js is planned; see [3D-RENDERER.md](3D-RENDERER.md). The simulation does not change for it.
