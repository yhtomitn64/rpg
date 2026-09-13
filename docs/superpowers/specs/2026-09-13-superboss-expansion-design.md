# Superboss Expansion: Simulator Fixes, NG+-Cycle Gating, New Bosses — Design

**Status:** Approved by Timothy, ready for implementation planning.

## Problem

Timothy wants several new superbosses beyond `superBossOne` (the one
worked example from `docs/superpowers/specs/2026-09-05-superboss-pass-design.md`),
each harder than the dragon, dropping better loot, possibly gated to
not appear until NG+. The obvious framing going in was "best-in-slot
gear can't keep up with NG+-scaled superbosses, so this needs a new
itemization tier" — `BACKLOG.md`'s own follow-up note on `superBossOne`
recorded a 0% win rate at NG+1/NG+2 for the maxed-Mythic build and
punted the fix to "future chase-gear/itemization work."

That framing turned out to be wrong, discovered by checking it against
Timothy's live save rather than trusting the old simulator finding:

- Timothy's real NG+2 character **beat `superBossOne` twice**, the
  second time at **100% HP remaining**, monster hits landing for
  "like 2 damage." His own diagnosis: "too much health but didn't hit
  hard enough."
- Re-running `scripts/simulate-balance.js` against the *real* per-cycle
  upgrade cap (`getMaxUpgradeLevel(cycle)` — +5 at NG+1, +7 at NG+2 —
  not the flat `MAX_UPGRADE_LEVEL` (+3) the file's own `maxedUpgrades()`
  had hardcoded regardless of cycle) still reported 0% at NG+2. The
  simulator and reality disagreed.
- Isolating why: disabling `superBossOne`'s `specialAttacks` entirely
  in a scratch run raised the NG+1 win rate from 40% to 87%. The
  simulator already attempts a parry on *every* monster turn at a flat
  rate (`PARRY_LAND_RATE_DEFAULT = 0.3`, `simulateBattle()` in
  `scripts/simulate-balance.js`) — it does not distinguish a routine
  hit from a *telegraphed* special attack. In the real game, the
  windup gets a distinct flavor line/icon specifically "so the player
  can tell a special is incoming" (2026-09-05 spec) — a real player
  reacts to that cue with more focus than to a routine swing, which
  the simulator's uniform rate doesn't model. Compounded across three
  concurrent special types (stun 25%/turn, slow 25%/turn, cooldown
  overload 20%/turn), this makes the simulator meaningfully more
  pessimistic than real play.
- The remaining NG+2 gap (0% in sim even with specials off, vs.
  Timothy's real 100%-HP win) is **not yet fully explained** — likely
  the simulator's "maxed ceiling" build being fixed at level 12 while
  Timothy's real win was at level 19-20 (NG+ carries level forward;
  the simulator has never modeled a level/cycle sweep), plus sustained
  buff-tonic uptime the simulator's flat `potions: 6` doesn't capture.
  Not resolved by this doc — resolved by Phase 0 below.

Conclusion, agreed with Timothy: this is a **retune-and-content** pass,
not a new-itemization-tier pass. Adding more gear headroom on top of a
boss that's already trivial once a player reaches its real gear
ceiling would make the actual problem — the difficulty curve within a
cycle — worse, not better.

## Design goal

Timothy's own framing, which this doc treats as the target: each new
superboss should **feel dangerous when a player first reaches its NG+
cycle**, and become **beatable — but not trivial — once that player
has farmed that cycle's gear ceiling.** Fights should be **shorter**
than `superBossOne`'s current 90-180 second real fights (less HP to
grind through), and should **cost real resources even at the gear
ceiling** — Timothy is explicitly fine with spending up to ~20 healing
potions over a fight on top of defense/DPS tonics, including
accounting for the fact that a flat-heal potion becomes proportionally
weaker each NG+ cycle as max HP scales (`NG_PLUS_HP_MULTIPLIER = 2` per
cycle) while the potion's own heal amount does not. The single
outcome this pass exists to prevent is the one Timothy just hit:
winning a superboss fight at full HP, needing zero consumables,
against a monster that can't punch through defense at all.

Numeric stat targets in this doc are **bands to validate via the
simulator during implementation, not final numbers** — same convention
every other stat-tuning doc in this repo uses (see
`2026-08-30-ng-plus-gear-progression-design.md`'s own "Open /
explicitly tunable numbers" section, or `superBossOne`'s two
in-code retune passes).

## Phase 0 — Simulator fixes (prerequisite, no game-facing change)

Nothing in Phase 2 can be trusted until these land, since this
session's investigation is exactly what happens when it isn't done:
`superBossOne` shipped tuned against numbers that didn't reflect the
real per-cycle upgrade cap, and stayed wrong for over a week of real
play before this session caught it by accident.

### 0a. Telegraphed-special parry rate, separate from the routine-hit rate

`scripts/simulate-balance.js`'s `simulateBattle()` currently rolls one
flat `parryLandRate` (default 0.3, overridable via `--parry-rate`) for
every monster turn, special or not (`rollSpecialAttack(monster.specialAttacks)`
is checked *after* the parry roll, so a telegraphed special gets
exactly the same attempt odds as a plain hit). Add a second, higher
default rate — proposed starting point **0.55**, tunable — applied
specifically when `rollSpecialAttack` returns non-null, representing a
real player's heightened attention to the windup's distinct flavor
line/icon. Thread it through the same way `parryLandRate` already is
(a function parameter, not a module-scope mutable, per this file's own
existing convention), with a matching `--special-parry-rate` CLI flag
mirroring `--parry-rate`.

`'stun'` still has no simulator-side action-suppression model (an
existing, explicitly-flagged conservative gap — see the `isReady`
block's own comment) — out of scope for this pass; still surfaced in
report output.

### 0b. Level/upgrade sweep mode

Today's `BUILDS` array is a fixed, hand-authored list — the "maxed
ceiling" builds are locked at level 12 regardless of which NG+ cycle
they're tested against, which is exactly the gap that hid the real
NG+2 outcome from this session's first simulator check. Add a sweep
mode (proposed flag: `--cycle-sweep <bossId>`) that, for a given
superboss id and each NG+ cycle from 0 up to some max (default 4),
generates a small matrix of builds spanning:

- **Cycle-start gear**: the level and gear a player realistically has
  on arriving at that cycle — approximate as "full iron/shop-tier
  gear, Superior tier where droppable, upgrade level 0 for the cycle,"
  at a level a few above the previous cycle's expected finish (first
  pass: use Timothy's own save as ground truth — he entered NG+2 at
  level 17 — and extrapolate linearly per cycle until real telemetry
  says otherwise).
- **Cycle-ceiling gear**: mythic-tier (or better, once Phase 2 adds
  loot) on every slot, upgraded to `getMaxUpgradeLevel(cycle)`, at a
  level consistent with having played through that cycle's content
  (Timothy's own wins were level 19-20 at NG+2's ceiling gear).
- One or two midpoints between them, for a visible curve rather than
  two endpoints.

Report win rate / average HP remaining / potions used per cell, same
shape `runMatchup()` already reports, just gridded across the sweep
instead of one row per fixed build. This directly answers "does the
difficulty curve within a cycle look like what Timothy wants" before
any real stat numbers are picked for Phase 2.

## Phase 1 — NG+-cycle gating (new plumbing)

No existing mechanism gates *appearing at all* on NG+ cycle — the only
precedent is `requiresTool`/`hasRequiredTool` (`mapScreen.js`), which
gates *crossing* a tile on inventory, not cycle. New, parallel
mechanism:

- `js/data/superBosses.js`'s `SUPER_BOSSES` entries gain an optional
  field: `debutNgPlusCycle: N` (omitted or `0` = available from a
  fresh game, exactly like `superBossOne` today — this pass doesn't
  retroactively gate the one already-shipped boss).
- Checked at both existing trigger points from the original superboss
  spec: the open-wilderness `superBossMarker` tile's position-lookup
  branch, and the `superBossEntrance` dungeon-entrance tile's action
  handler (both in `mapScreen.js`, per the original spec's "same
  handful of touch-points every existing entrance tile already has").
- **UX**: unlike a tool gate, a superboss encounter was never a
  required crossing — it's always an optional, off-the-beaten-path
  encounter, so there's nothing to physically block. Below
  `debutNgPlusCycle`, stepping on the tile does nothing but show a
  short flavor message (new small message table, same shape
  `getLockedGateMessage`/`getGateProximityMessage` already use for
  tool gates) — e.g. "You sense something powerful here, but it hasn't
  woken yet." No new tile art or blocked-passage state needed.
- `handleEncounter`/`getNgPlusCombatOverrides` already scale any
  monster for *every* cycle unconditionally (confirmed in
  `js/systems/ngPlus.js` — "no ceiling check left anywhere in this
  file"), so a superboss gated to debut at cycle 2 keeps auto-scaling
  at cycle 3, 4, and beyond with zero extra code once it's reachable —
  same as `superBossOne` does today.

## Phase 2 — Four new superbosses, one per cycle

`superBossTwo` through `superBossFive`, `debutNgPlusCycle` 1 through 4
respectively — `superBossOne` stays the ungated, base-game introduction
to the system. Each is a new `js/data/monsters.js` entry
(`isSuperBoss: true`, `forceFullBattle: true`, its own `specialAttacks`
kit — reusing the existing three types or adding boss-specific
variety is an authoring choice, not new mechanic work) and its own
`SUPER_BOSSES` entry, placed by Timothy via `tools/terrain-painter/`
exactly like `superBossOne` was.

### Stat/loot target per boss (validated via Phase 0b's sweep, not guessed)

- **Cycle-start gear**: comparable to the original spec's own bar for
  `superBossOne` — roughly 15-30% average HP remaining, heavy potion
  consumption, a real non-trivial loss rate even for a well-prepared
  arrival.
- **Cycle-ceiling gear**: winnable, but explicitly *not* Timothy's
  recent 100%-HP/no-potions outcome — target meaningful resource
  spend (tens of potions is an acceptable outcome per the design goal
  above, not a sign of mistuning) and a real fight length, not an
  instant kill.
- **Fight length**: shorter than `superBossOne`'s current 90-180s real
  fights. Lower base HP than a naive same-cycle scale-up of
  `superBossOne` would suggest; compensate with attack scaled high
  enough relative to `getMaxUpgradeLevel(cycle)`-geared defense that
  the fight stays a real DPS race rather than a long grind, addressing
  Timothy's own diagnosis directly ("too much health but didn't hit
  hard enough").
- **Loot**: one guaranteed `apex`-tier drop each (`dropTable: [{
  itemId, chance: 1, tier: 'apex' }]`, same mechanism as
  `superBossOne`'s `ferocityFang`). Reuse the existing 3-item pool
  (`parryMasterRing`, `unshakenCharm`, `stormringOfHaste` —
  `ferocityFang` stays `superBossOne`'s own) across the earlier-cycle
  bosses; author 1-2 brand-new unique items for the higher-cycle
  bosses for variety, same shape as the existing pool (pure data,
  `getEquipmentBonuses` already sums whatever stat fields are
  present) — no new numeric tier above `apex` needed, since the
  existing `tier × (1 + 0.25 × upgradeLevel)` compounding already
  provides open-ended power growth without one (this is the same
  reasoning that makes the per-cycle upgrade cap the actual lever
  behind this whole investigation).

## Files touched

- `scripts/simulate-balance.js` — special-attack parry rate split
  (0a), `--cycle-sweep` mode (0b), `maxedUpgrades()` fixed to always
  use `getMaxUpgradeLevel(cycle)`.
- `js/data/superBosses.js` — `debutNgPlusCycle` field; four new
  entries (placeholder `screenId: null` until Timothy places each).
- `js/data/monsters.js` — four new superboss entries.
- `js/data/items.js` — 1-2 new unique-effect items for the loot pool.
- `js/screens/mapScreen.js` — `debutNgPlusCycle` check at both
  existing superboss trigger points; new locked-flavor message table.
- Map-editor (`tools/terrain-painter/`) — no changes anticipated;
  existing "Place Super-Boss Marker" mode already supports picking any
  `SUPER_BOSSES` id, this just adds a field on the data side.

## Testing

- `tests/toolDungeonMaps.test.js`-style null-placeholder coverage
  extends to the four new `SUPER_BOSSES` entries (unplaced, inert,
  same as today).
- New unit coverage for the `debutNgPlusCycle` gate at both trigger
  points (below/at/above threshold), mirroring existing
  `requiresTool`/`hasRequiredTool` test shape.
- `scripts/simulate-balance.js` changes are a balance tool, not part
  of `npm test` (consistent with this file's existing non-test status)
  — validated by running it, not by an automated assertion.
- Each new superboss gets the same Monte-Carlo-plus-real-telemetry
  reconciliation `superBossOne` got (two retune passes documented
  in-code) before being considered tuned — this doc sets targets and
  methodology, not final constants.

## Open / explicitly tunable numbers

Every number in this doc — the 0.55 special-parry-rate starting point,
the cycle-start-gear level extrapolation, the cycle-ceiling HP/attack
targets, which two bosses get new unique items vs. reused ones — is a
starting hypothesis for implementation and playtesting, flagged
explicitly so the implementation plan doesn't treat any of it as
final, per this repo's standing convention (see this doc's own
"Design goal" section).

## Out of scope

- Retuning `superBossOne` itself. It's live, has real telemetry
  showing it's beatable (if currently too easy at the ceiling and too
  hard mid-climb), and isn't part of "several new superbosses" — a
  future pass can revisit it once Phase 0/1 exist, using the same
  tooling.
- The remaining ~5 superbosses beyond this pass's four — same "system
  supports any number, only a few ship designed" pattern the original
  spec established.
- Any change to `js/systems/bossTiers.js` (the dragon's own
  escalating-tier rematch system) or the dragon's own stats — this
  pass is superboss-only, per the original spec's own scope boundary.
- A new item-quality tier above `apex` — explicitly considered and
  rejected above; the per-cycle upgrade cap already provides the
  needed headroom, which is the core finding this entire doc is built
  on.

## Validation results (implementation)

Task 9 ran `node scripts/simulate-balance.js --cycle-sweep <bossId>
--trials 2000` for all four new bosses and read each one's own
debut-cycle rows against this doc's Phase 2 target bands (cycle-start:
~15-30% avg HP remaining on a win, heavy potions, a real non-trivial
loss rate; cycle-ceiling: a clear win with real resource spend, not a
near-zero-cost win). Two of the four needed a retune; two did not.
Full sweep output for all four (plus a superBossOne control run) is in
`task-9-report.md`.

**Cross-boss finding on the cycle-start row, before the per-boss
notes**: every one of the four new bosses' own debut-cycle
cycle-start row measured a literal 0.00% win rate (0/2000) — and so
did a control run of the already-shipped, twice-retuned `superBossOne`
at its own debut cycle (NG+0), also 0.00%. That's not four coincident
mistunings; it's this doc's own Phase 2 bullet pointing the 15-30%
band at the wrong row. `monsters.js`'s `superBossOne` comment (the
"comparable... bar" this doc's cycle-start bullet cites) records that
the 15-30% figure was hit by the *maxed Mythic L12 + rings build*,
while a "veteran L11 (full iron)" build — the closer analogue to this
tool's cycle-start tier — "lost outright (0%)" in that same original
validation. So the 15-30% band belongs to a ceiling-tier build, not
the cycle-start-tier build this doc's bullet attaches it to. No retune
was made to chase this — it's a target-row mislabel, not a stat
problem, and is flagged here for a future doc correction rather than
spent against any boss's 2-pass cap. Separately, the sweep's
cycle-ceiling builds are constructed with a fixed `potions: 6`, so no
row can ever report more than 6 potions used — several ceiling rows
below read as "near-saturated" at 5.5-6.0 rather than literally
capped, but the tool as built cannot distinguish "used all it had" from
"would have used more"; this doc's "up to ~20 potions is fine" ceiling
is therefore not directly testable with this tool in its current form.

**superBossTwo** (debuts NG+1) — no retune. Own debut-cycle
cycle-ceiling row: 74.30% win / 36.27% avg HP remaining on a win / 5.59
of 6 potions used — a clear win with real, near-saturated resource
spend, matching the cycle-ceiling target directly. Cycle-start row:
0.00% win / 0.00% hp-left / 1.00 potions, consistent with the
cross-boss finding above rather than a boss-specific problem. Left
unchanged from Task 7's first pass (hp 1100/atk 60/def 21).

**superBossThree** (debuts NG+2) — retuned ONCE. First pass candidate
(hp 800/atk 70/def 19) measured 0.00% win / 4.19 of 6 potions used at
its own NG+2 debut-cycle ceiling row — a losing grind the maxed L18
build couldn't close even while spending most of its potions, not a
burst-death, so both `hp` and `attack` came down together: hp
800→640 (-20%), attack 70→60 (-14%), defense untouched. Re-running
landed the same row at 33.30% win / 26.50% avg HP remaining on a win /
5.66 of 6 potions used — a real win with heavy resource spend, inside
the cycle-ceiling target. One retune pass was enough; the second pass
budget was not used.

**superBossFour** (debuts NG+3) — retuned TWICE, still below target
after both passes. First pass candidate (hp 563/atk 77/def 17)
measured 0.20% win / only 0.87 of 6 potions used at its own NG+3
debut-cycle ceiling row — a near-instant burst death (dying before the
sim's potion-threshold check fires), the same failure mode
`superBossOne`'s own reverted first retune pass hit. Fix: attack down,
hp untouched — 77→58 (-25%). Re-running showed potions jump to 5.52/6
(the burst-death symptom gone) but win rate barely moved (0.50%) — now
a losing grind instead of an instant kill. Second pass: hp down too,
attack held at 58 — 563→480 (-15%). Re-running landed 7.70% win /
20.60% avg HP remaining on a win / 5.46 of 6 potions used — a real,
if narrow, win with heavy resource spend. This is not the 0%/100%
failure mode the brief flags as "badly off," but the win rate is still
on the low side of "clear win." Two passes is this task's own cap;
left as-is for Timothy's real playtesting rather than a third guess,
same as every prior superboss/dragon retune in this project's history.

**superBossFive** (debuts NG+4, the hardest of this pass's four) —
retuned TWICE, still NOT fixed after both passes (flagged, not
resolved). First pass candidate (hp 406/atk 82/def 16) measured 0.30%
win at its own NG+4 debut-cycle ceiling row. Fix: attack down, hp
untouched — 82→59 (-28%). Re-running left the debut-cycle win rate
essentially unchanged (0.00% at 2000 trials, 3.02 of 6 potions used) —
while every earlier, non-debut cycle jumped toward a 100% win rate, a
direct consequence of this boss's own atk/def NG+ multiplier (×2.44 at
cycle 4 vs ×1 at cycle 0) compounding faster than any of the other
three bosses. Second pass: attack down again, hp still untouched —
59→48 (-19% more, -41% cumulative from the original 82). Re-running
still landed the own-debut-cycle ceiling row at 0.50% win / 8.86% avg
HP remaining on a win / 5.96 of 6 potions used — essentially
unwinnable even at maxed ceiling gear, the 0%-ish failure mode the
brief explicitly calls "badly off." Two passes is this task's own cap;
per the brief's own instruction, this is left as-is rather than
iterated further. A future pass should consider cutting `hp` instead
of (or alongside) `attack` — attack-only cuts already made every
earlier cycle nearly free, so the next lever to try is different from
the one this task used twice, once Timothy has actually placed and
fought it for real.
