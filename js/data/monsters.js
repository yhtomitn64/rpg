export const MONSTERS = {
  // Near-town roster (boar/bat/snake/goblin/frog) and far-corner roster
  // (direWolf/spider/scorpion) had their attack raised 2026-09-02.
  // calculateDamage floors at 1 once defense >= attack
  // (js/systems/combat.js), and these were still at their original ~9-14
  // attack while player defense climbs every level - by ~L4-5 combat was
  // already 0-potion floor damage. A bump big enough to still clear the
  // full-iron-gear defense band (~19-22, the bar orc/wraith/skeleton
  // below were tuned to) turned out to make the very first L1 fight
  // dangerously swingy instead (a flat monster attack has to work across
  // the whole L1-to-full-iron defense spread, and that spread is too
  // wide for one number to be safe at both ends) - see
  // docs/superpowers/specs/2026-09-01-balance-tuning-roadmap-handoff.md's
  // Session 3. Settled for a smaller bump that keeps L1 safe and pushes
  // the trivialization point later into leveling, accepting these floor
  // out again by full iron gear same as before - by then the player has
  // moved on to dungeon-tier content anyway.
  boar: {
    id: 'boar', name: 'Snorty McPigface', emoji: '🐗',
    hp: 77, attack: 15, defense: 1, speed: 4,
    xp: 16, goldRange: [4, 8],
    dropTable: [{ itemId: 'leatherScrap', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'melee',
  },
  bat: {
    id: 'bat', name: 'Spooky Pancake', emoji: '🦇',
    hp: 55, attack: 13, defense: 0, speed: 7,
    xp: 11, goldRange: [2, 7],
    dropTable: [{ itemId: 'batWing', chance: 0.25 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'melee',
  },
  snake: {
    id: 'snake', name: 'Slippery Breadstick', emoji: '🐍',
    hp: 60, attack: 15, defense: 1, speed: 5,
    xp: 16, goldRange: [4, 9],
    dropTable: [{ itemId: 'snakeFang', chance: 0.25 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'melee',
  },
  goblin: {
    id: 'goblin', name: 'Mean Meatball', emoji: '👺',
    hp: 67, attack: 15, defense: 2, speed: 4,
    xp: 22, goldRange: [5, 13],
    dropTable: [
      { itemId: 'goblinClub', chance: 0.15 },
      { itemId: 'ironScrap', chance: 0.2 },
      { itemId: 'potion', chance: 0.1 },
    ],
    attackStyle: 'ranged', projectileEmoji: '🍙',
  },
  direWolf: {
    id: 'direWolf', name: 'Mega Muffin', emoji: '🐺',
    hp: 100, attack: 19, defense: 3, speed: 6,
    xp: 32, goldRange: [8, 15],
    // moonstoneShard added 2026-09-09 as the ring upgrade material's source
    // - a howling wolf and a moonstone felt like the natural pairing among
    // the roster.
    dropTable: [
      { itemId: 'wolfPelt', chance: 0.3 },
      { itemId: 'moonstoneShard', chance: 0.15 },
      { itemId: 'potion', chance: 0.1 },
    ],
    attackStyle: 'melee',
  },
  spider: {
    id: 'spider', name: 'Eight-Leg Eggroll', emoji: '🕷️',
    hp: 85, attack: 17, defense: 2, speed: 5,
    xp: 29, goldRange: [7, 14],
    dropTable: [{ itemId: 'spiderSilk', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'ranged', projectileEmoji: '🥟',
  },
  frog: {
    id: 'frog', name: 'Ribbity Ravioli', emoji: '🐸',
    hp: 58, attack: 13, defense: 1, speed: 6,
    xp: 13, goldRange: [3, 8],
    dropTable: [{ itemId: 'frogSkin', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'melee',
  },
  scorpion: {
    id: 'scorpion', name: 'Spicy Skewer', emoji: '🦂',
    hp: 90, attack: 18, defense: 3, speed: 6,
    xp: 30, goldRange: [7, 15],
    dropTable: [{ itemId: 'scorpionVenom', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'melee',
  },
  // Tool-dungeon guardians: guaranteed (chance: 1) single-item drop, so
  // placing their dungeon is a reliable way to gate progression on a specific
  // tool. forceFullBattle skips the usual solo-weak-mob pre-fight
  // surrender/flee roll (js/main.js handleEncounter) - deliberately NOT
  // isBoss, since isBoss also sets state.flags.dungeonBossDefeated (which
  // would falsely unlock NG+ before the real dragon is ever fought) and
  // blocks fleeing mid-battle, neither of which apply here. Stats sit a step
  // above the corner-tier roster (direWolf/spider/scorpion) since a
  // guaranteed-reward mini-boss should feel tougher than an ordinary
  // wilderness encounter, but well under dungeon-tier (orc/wraith) so an
  // early gate doesn't require end-game gear.
  //
  // Retuned 2026-09-05 to a real per-tool target level, replacing the
  // same-night +50%-HP-only stopgap: "for axe which is first we should
  // target user having got to like level 5 and tune that boss for that.
  // Then for pick I think a few levels more than that and then canoe more
  // than that." axeGuardian(L5)/pickGuardian(L7)/boatGuardian(L9) each got
  // their own attack/defense pass, not just more HP - axe and pick used to
  // share an identical stat block despite now targeting different levels,
  // so they diverge for the first time here.
  //
  // Numbers came from a throwaway Monte Carlo script built on the real
  // js/systems/combat.js|abilities.js|parry.js functions (same approach as
  // scripts/simulate-balance.js), run against Timothy's own real telemetry
  // gear at each target level - not hand-guessed. Important calibration
  // caveat found while doing this: the simulator's simulated player has
  // zero reaction latency (acts every single 300ms tick, no hesitation),
  // which makes its win-rate/HP-remaining output systematically optimistic
  // - a real level-7 player's logged axeGuardian fight (old stats) ran
  // ~2x longer and ended at 78% HP where the simulator would have shown
  // ~99% for the identical matchup. So every number below was tuned to
  // land around 48-53% average HP remaining *in the simulator* for a
  // well-geared build (several potions burned, 7-15s), deliberately well
  // below a "comfortable" simulator result, expecting real play to run
  // harder still. A deliberately under-geared player at the same level
  // (starter/base Iron, no upgrades, no accessory) loses these fights
  // outright rather than scraping by - gearing up before attempting one
  // now actually matters.
  axeGuardian: {
    id: 'axeGuardian', name: 'Axe Guardian', emoji: '🪓',
    hp: 260, attack: 34, defense: 10, speed: 9,
    xp: 45, goldRange: [15, 25],
    dropTable: [{ itemId: 'axe', chance: 1 }],
    forceFullBattle: true,
    attackStyle: 'melee',
  },
  pickGuardian: {
    id: 'pickGuardian', name: 'Pick Guardian', emoji: '⛏️',
    hp: 320, attack: 42, defense: 13, speed: 10,
    xp: 45, goldRange: [15, 25],
    dropTable: [{ itemId: 'miningPick', chance: 1 }],
    forceFullBattle: true,
    attackStyle: 'melee',
  },
  // Sits behind a gate meant to require axe + pick already (Timothy's map
  // design, not enforced in code - see TOOL_DUNGEON_ENTRANCES's boat entry
  // placement), so a step tougher than the axe/pick guardians. Retuned
  // 2026-09-05 for a level-9 target - see axeGuardian's own comment above
  // for the methodology.
  boatGuardian: {
    id: 'boatGuardian', name: 'Boat Guardian', emoji: '🛶',
    hp: 420, attack: 56, defense: 18, speed: 11,
    xp: 55, goldRange: [18, 28],
    dropTable: [{ itemId: 'boat', chance: 1 }],
    forceFullBattle: true,
    attackStyle: 'melee',
  },
  // Sits behind a gate meant to require axe + pick + boat already
  // (Timothy's map design, not enforced in code) - a step tougher than
  // boatGuardian, since "free repeatable trip to/from town from
  // anywhere" is the strongest of the four tools. See
  // docs/superpowers/specs/2026-09-01-portal-scroll-design.md.
  //
  // Retuned 2026-09-05 for a level-10 target (one above boatGuardian, one
  // below the dragon) - its map entrance is still unplaced
  // (TOOL_DUNGEON_ENTRANCES.portal has screenId: null in
  // js/data/toolDungeons.js, "I don't even remember how to get it...
  // waiting for me to place via map editor"), so this is inert until
  // Timothy actually places it, but reaching it implies already having
  // collected axe+pick+boat - see axeGuardian's own comment above for the
  // shared methodology.
  portalGuardian: {
    id: 'portalGuardian', name: 'Portal Guardian', emoji: '🌌',
    hp: 500, attack: 58, defense: 19, speed: 12,
    xp: 65, goldRange: [22, 32],
    dropTable: [{ itemId: 'portalCircle', chance: 1 }],
    forceFullBattle: true,
    attackStyle: 'melee',
  },
  // Retuned 2026-09-05 for a level-11 target, the hardest of the five
  // bosses by design (lowest win rate / most potions burned in the
  // simulator of any fight in this pass) - see axeGuardian's own comment
  // above for the full methodology.
  dragon: {
    id: 'dragon', name: 'Dragon', emoji: '🐉',
    hp: 600, attack: 58, defense: 22, speed: 13,
    xp: 200, goldRange: [65, 100],
    dropTable: [
      { itemId: 'dragonScaleMail', chance: 0.6 },
      { itemId: 'dragonFang', chance: 0.4 },
    ],
    isBoss: true,
    attackStyle: 'ranged', projectileEmoji: '🔥',
  },
  // Dungeon tier. Attack is deliberately set well above the ~19-22 defense a
  // player reaches with the full iron shop set, so stacking cheap defense no
  // longer drops these to the calculateDamage 1-point floor. See
  // scripts/simulate-balance.js for the tuning evidence.
  orc: {
    id: 'orc', name: 'Super Mean Meatloaf', emoji: '👹',
    hp: 180, attack: 32, defense: 8, speed: 8,
    xp: 60, goldRange: [18, 28],
    dropTable: [{ itemId: 'orcTusk', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'melee',
    // Optional field: dungeon-tier only. ~35% chance to replace generic "A wild X appears!" (see pickAppearLine in js/systems/combat.js).
    flavorLines: [
      'You smell burnt garlic bread. Super Mean Meatloaf has entered the room.',
      'Super Mean Meatloaf lumbers out of the shadows, still steaming with rage.',
      'Super Mean Meatloaf glares at you like you insulted its secret recipe.',
    ],
  },
  wraith: {
    id: 'wraith', name: 'Ghost Apple Supreme', emoji: '👻',
    hp: 170, attack: 32, defense: 4, speed: 11,
    xp: 63, goldRange: [18, 30],
    dropTable: [{ itemId: 'wraithEssence', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'ranged', projectileEmoji: '🍎',
    flavorLines: [
      'A chill rolls in. Ghost Apple Supreme has come for seconds.',
      'Ghost Apple Supreme drifts through the wall, unnervingly translucent and smelling faintly of cinnamon.',
      'Ghost Apple Supreme rattles its core ominously.',
    ],
  },
  skeleton: {
    id: 'skeleton', name: 'Bone-in Biscuit', emoji: '💀',
    hp: 175, attack: 32, defense: 6, speed: 9,
    xp: 61, goldRange: [18, 29],
    dropTable: [{ itemId: 'boneFragment', chance: 0.3 }, { itemId: 'potion', chance: 0.1 }],
    attackStyle: 'ranged', projectileEmoji: '🦴',
    flavorLines: [
      'Bones rattle in the dark. Bone-in Biscuit clatters toward you.',
      'Something crunches underfoot — Bone-in Biscuit was already here.',
      'Bone-in Biscuit assembles itself from the rubble, grinning without lips.',
    ],
  },
  // Rare elite, injected by js/systems/eliteEncounter.js at a flat 5% chance
  // whenever a regular encounter would fire (wilderness or dungeon), always
  // solo. Deliberately not isBoss - playerFlee() only blocks fleeing when
  // isBoss is set, so this stays fleeable for free. Stats are 88% of the
  // dragon's own tier-0 stats (150/34/12/11): a real near-dragon gear-check,
  // not literally boss-equivalent.
  jurassicJerky: {
    id: 'jurassicJerky', name: 'Jurassic Jerky', emoji: '🦖',
    hp: 132, attack: 30, defense: 11, speed: 10,
    xp: 160, goldRange: [55, 90],
    dropTable: [{ itemId: 'fossilFang', chance: 0.5 }, { itemId: 'potion', chance: 0.15 }],
    attackStyle: 'ranged', projectileEmoji: '🍖',
    isElite: true,
  },

  // Super-boss pass worked example - see
  // docs/superpowers/specs/2026-09-05-superboss-pass-design.md. Placeholder
  // codename only (superBossOne) - not a creative name, rename freely
  // before this ships.
  //
  // Retuned TWICE from the plan's starting candidate (hp 3200/atk 70/def 30)
  // after running scripts/simulate-balance.js (which got a new
  // SUPER_BOSS_MATCHUP_IDS, generic over any isSuperBoss monster) against
  // every existing build - see task-14-report.md for both full simulator
  // passes:
  //   1st pass (reverted): held attack/defense fixed at the candidate's own
  //   70/30 and swept hp down to 1050 to hit a 15-30% HP-remaining target.
  //   Review caught that this made the "hardest fight in the game" measure
  //   out WEAKER than the already-shipping Dragon tier 1 (1200hp/73atk/
  //   28def) and tier 2 (2400/91/34) - holding attack/defense fixed forced
  //   hp down to a small number because 70 attack vs. the maxed build's 43
  //   defense only left the player ~6 unparried hits of survival budget,
  //   turning the fight into a parry coin-flip instead of a grueling wall.
  //   2nd pass (this one): held hp >= 3000 (comfortably above Dragon tier
  //   2's 2400) and swept attack/defense DOWN instead (55/24, vs. the
  //   maxed build's 41atk/43def - a much smaller damage-per-hit, buying
  //   real survival time across a genuinely high HP pool). Converged to
  //   hp: 3000, attack: 55, defense: 24 - the maxed Mythic L12 (NG+2,
  //   +rings) build (79hp/41atk/43def, every slot Mythic+3, both
  //   superboss-only rings) lands 10% win rate / 17% avg HP remaining on a
  //   win / 6.0 of 6 potions used (5000 trials, 0% stalemateRate) -
  //   meaningfully BELOW its 18% win rate against Dragon tier 1 (so this
  //   really is the harder fight), within the spec's 15-30% band, with
  //   maxed-out potion use and a real ~90% loss rate. "veteran L11 (full
  //   iron)" and the Mythic-no-rings variant both still lose outright
  //   (0%). Sanity-checked across pickMonsterVariant's +/-15% roll range
  //   (defense untouched, hp/attack scaled together): Puny lands ~100%
  //   win, Savage ~0% - a wide swing, but the same qualitative shape every
  //   guardian already has today under this same variant system (not a
  //   new gap this task introduced - see task-14-report.md for the full
  //   numbers and discussion). NG+1/NG+2: the maxed build cannot beat this
  //   fight once IT is also NG+1/NG+2-scaled (0% at both cycles) - flagged
  //   in task-14-report.md as a real, separate finding about the
  //   post-NG+1 game overall rather than something this task's scope
  //   covers fixing.
  //
  //   Post-review addendum: the variant-roll sanity check above is now
  //   purely historical context, not live behavior - a later fix in this
  //   same branch exempted every forceFullBattle monster (this one and all
  //   four tool guardians) from pickMonsterVariant entirely (see
  //   js/systems/monsterVariants.js's pickVariantOverrides), so
  //   superBossOne's stats above are exactly what a real encounter always
  //   uses, never +/-15% varied.
  superBossOne: {
    id: 'superBossOne', name: 'Super Boss One [PLACEHOLDER NAME]', emoji: '💀',
    hp: 3000, attack: 55, defense: 24, speed: 14,
    xp: 500, goldRange: [150, 220],
    dropTable: [{ itemId: 'ferocityFang', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.25, durationMs: 1200 },
      { type: 'slow', chancePerTurn: 0.25, slowPercent: 25, durationMs: 4000 },
      { type: 'cooldownOverload', chancePerTurn: 0.2, gcdMs: 6000 },
    ],
    attackStyle: 'melee',
  },
  // Debuts at NG+1 (see SUPER_BOSSES.superBossTwo's debutNgPlusCycle).
  // FIRST-PASS STATS, not final - validate/retune with:
  //   node scripts/simulate-balance.js --cycle-sweep superBossTwo
  // before Timothy places this for real. Base numbers below produce, once
  // getNgPlusCombatOverrides scales them at NG+1 (hp x2, atk/def x1.25):
  // effective hp 2200 / atk 75 / def 26 - meaningfully less HP and more
  // attack than superBossOne's own NG+1-scaled 6000/69/30, per this pass's
  // "shorter, harder-hitting" design goal.
  superBossTwo: {
    id: 'superBossTwo', name: 'Super Boss Two [PLACEHOLDER NAME]', emoji: '👹',
    hp: 1100, attack: 60, defense: 21, speed: 14,
    xp: 650, goldRange: [180, 260],
    dropTable: [{ itemId: 'parryMasterRing', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.25, durationMs: 1200 },
      { type: 'slow', chancePerTurn: 0.25, slowPercent: 25, durationMs: 4000 },
      { type: 'cooldownOverload', chancePerTurn: 0.2, gcdMs: 6000 },
    ],
    attackStyle: 'melee',
  },
  // Debuts at NG+2. Retuned ONCE (Task 9) from the plan's first-pass
  // candidate (hp 800/atk 70/def 19) after
  //   node scripts/simulate-balance.js --cycle-sweep superBossThree --trials 2000
  // showed its own NG+2 debut-cycle ceiling row at 0% win rate (2000/2000
  // losses) despite 4.19 of 6 potions used - a losing grind the maxed L18
  // build couldn't close, not a burst-death, so both hp and attack came
  // down together (same "hold nothing fixed, cut proportionally" move as
  // superBossOne's own retune, just smaller): hp 800->640 (-20%), attack
  // 70->60 (-14%), defense untouched. That's the only pass this boss
  // needed - re-running afterward landed its NG+2 debut row at 33% win /
  // 27% avg HP remaining on a win / 5.66 of 6 potions used at cycle-ceiling
  // gear (a real win with heavy resource spend, not a walkover) and 0%
  // win / 0 potions at cycle-start gear (see the Validation results
  // section of docs/superpowers/specs/2026-09-13-superboss-expansion-design.md
  // for why that cycle-start number isn't actually alarming). Base numbers
  // now produce, at NG+2 (hp x4, atk/def x1.5625): effective hp 2560 /
  // atk 94 / def 30 - still well under superBossOne's own NG+2-scaled
  // 12000/86/38 (the exact fight Timothy beat at 100% HP doing "like 2
  // damage"), deliberately far less HP, comparable attack.
  superBossThree: {
    id: 'superBossThree', name: 'Super Boss Three [PLACEHOLDER NAME]', emoji: '🧟',
    hp: 640, attack: 60, defense: 19, speed: 15,
    xp: 850, goldRange: [220, 320],
    dropTable: [{ itemId: 'unshakenCharm', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.3, durationMs: 1300 },
      { type: 'slow', chancePerTurn: 0.25, slowPercent: 30, durationMs: 4000 },
      { type: 'cooldownOverload', chancePerTurn: 0.2, gcdMs: 6500 },
    ],
    attackStyle: 'ranged', projectileEmoji: '🦴',
  },
  // Debuts at NG+3. Retuned TWICE (Task 9) from the plan's first-pass
  // candidate (hp 563/atk 77/def 17) - see task-9-report.md for both full
  // sweep passes:
  //   1st pass: its own NG+3 debut-cycle ceiling row started at a 0.20%
  //   win rate with only 0.87 of 6 potions used - a near-instant burst
  //   death (dying before the sim's potion-threshold check even fires),
  //   the same "unparried-hit budget too small" failure superBossOne's
  //   own reverted 1st pass hit. Fix: attack down, hp untouched -
  //   77->58 (-25%). Re-running showed potions jump to 5.52/6 (the
  //   burst-death symptom was gone) but win rate barely moved (0.50%) -
  //   now a losing grind instead of an instant kill.
  //   2nd pass (this one): hp down too, attack held at 58 - 563->480
  //   (-15%), since the grind-not-burst shape pointed at hp as the
  //   remaining lever. Converged to hp: 480, attack: 58 - its own NG+3
  //   debut-cycle ceiling row lands 7.7% win rate / 21% avg HP remaining
  //   on a win / 5.46 of 6 potions used (2000 trials) - a real, if
  //   still narrow, win with heavy resource spend. Below the pass cap's
  //   comfort zone but not the 0%/100% failure mode the brief flags, and
  //   two passes is this task's own limit - left for Timothy's real
  //   playtesting rather than a 3rd guess (see the Validation results
  //   section of docs/superpowers/specs/2026-09-13-superboss-expansion-design.md).
  // Base numbers now produce, at NG+3 (hp x8, atk/def x1.953125):
  // effective hp 3840 / atk 113 / def 33.
  superBossFour: {
    id: 'superBossFour', name: 'Super Boss Four [PLACEHOLDER NAME]', emoji: '👺',
    hp: 480, attack: 58, defense: 17, speed: 15,
    xp: 1100, goldRange: [280, 400],
    dropTable: [{ itemId: 'stormringOfHaste', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.3, durationMs: 1400 },
      { type: 'slow', chancePerTurn: 0.3, slowPercent: 30, durationMs: 4500 },
      { type: 'cooldownOverload', chancePerTurn: 0.25, gcdMs: 6500 },
    ],
    attackStyle: 'melee',
  },
  // Debuts at NG+4, the hardest of this pass's four AT ITS OWN DEBUT
  // CYCLE. At any single fixed NG+ cycle it's actually the WEAKEST of
  // all five superbosses (One through Five) on both base hp (406, lowest)
  // and base attack (48, lowest) - a direct consequence of the two attack
  // cuts made during retuning below. It only reads as "hardest" because
  // NG+'s exponential scaling (hp x2^cycle, atk/def x1.25^cycle) compounds
  // more times before a player ever meets it than for the earlier-debuting
  // bosses. A future author extending this roster shouldn't assume its raw
  // stat numbers reflect difficulty in isolation from its debut-cycle
  // context. Retuned TWICE
  // (Task 9) from the plan's first-pass candidate (hp 406/atk 82/def 16)
  // - see task-9-report.md for both full sweep passes:
  //   1st pass: its own NG+4 debut-cycle ceiling row started at a 0.30%
  //   win rate. Attack down, hp untouched - 82->59 (-28%). Re-running
  //   left win rate essentially unchanged (0.00% at 2000 trials) with
  //   potions at 3.02/6 (a mix of early and drawn-out losses, not a
  //   clean burst-death signature) - meanwhile every earlier, non-debut
  //   cycle jumped toward 100% win, a direct consequence of this boss's
  //   own atk/def NG+ multiplier (x2.44 at cycle 4 vs x1 at cycle 0)
  //   compounding fastest of all four new bosses.
  //   2nd pass (this one): attack down again, hp still untouched -
  //   59->48 (-19% more, -41% cumulative from the original 82). Its own
  //   NG+4 debut-cycle ceiling row still lands at 0.50% win rate / 9%
  //   avg HP remaining on a win / 5.96 of 6 potions used (2000 trials) -
  //   essentially unwinnable even at maxed ceiling gear, the 0%-ish
  //   failure mode the brief calls out, and two passes is this task's
  //   own cap. NOT fixed - flagged as-is rather than continuing to
  //   guess; needs a real look (possibly hp down instead of/along with
  //   attack, now that lower cycles are already trivial at this attack
  //   level) once Timothy has actually placed and fought it, same as
  //   every prior superboss retune in this project's history (see the
  //   Validation results section of
  //   docs/superpowers/specs/2026-09-13-superboss-expansion-design.md).
  // Base numbers now produce, at NG+4 (hp x16, atk/def x2.44140625):
  // effective hp 6496 / atk 117 / def 39.
  superBossFive: {
    id: 'superBossFive', name: 'Super Boss Five [PLACEHOLDER NAME]', emoji: '🐲',
    hp: 406, attack: 48, defense: 16, speed: 16,
    xp: 1400, goldRange: [350, 500],
    dropTable: [{ itemId: 'guardiansLastStand', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.3, durationMs: 1500 },
      { type: 'slow', chancePerTurn: 0.3, slowPercent: 35, durationMs: 5000 },
      { type: 'cooldownOverload', chancePerTurn: 0.25, gcdMs: 7000 },
    ],
    attackStyle: 'ranged', projectileEmoji: '❄️',
  },
};
