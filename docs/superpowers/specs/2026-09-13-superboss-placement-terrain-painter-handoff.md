# Superboss placement + terrain-painter improvements — session handoff

**Status:** in progress, handed off 2026-09-13 for context-window reasons
mid-session, not because the work is blocked. Branch
`feature/superboss-expansion`, worktree at
`.claude/worktrees/superboss-expansion-impl` (or wherever a fresh
session's own worktree lands after `EnterWorktree` — recreate it from
`origin/feature/superboss-expansion`, don't start from `main`). PR:
<https://github.com/yhtomitn64/rpg/pull/14> (open, **not merged** —
`main` deploys on push, and there's a known bug below blocking that
anyway).

## What's fully done (don't redo this)

The whole superboss-expansion plan (`docs/superpowers/plans/2026-09-13-superboss-expansion.md`,
spec `docs/superpowers/specs/2026-09-13-superboss-expansion-design.md`)
shipped end to end via subagent-driven-development: balance-simulator
fixes, NG+-cycle gating, four new superbosses, a final whole-branch
review, and a fix wave — versions 0.34.7 through 0.35.1. Then Timothy
placed all five superbosses in the world himself using
`tools/terrain-painter/` and authored a dungeon for each, which
surfaced real gaps in that tool — commit `9fd20cf` (0.35.2) covers his
placement work plus the fixes below. **Read PR #14's description before
doing anything** — it has the full history phase by phase and is more
detailed than this handoff needs to repeat.

## The one known bug (Timothy's map content, not a code bug) — worse than first reported

`npm run test` is currently **1229/1230** (`superBossFive` in
`tests/superBosses.test.js`, `assertFullyReachable`). The original
handoff text here described this as "a walkable tile at (45,0), right
next to the guardian, disconnected from the path back to the
entrance" - that undersold it. `assertFullyReachable` uses `assert.ok`
*inside* its scan loop, so it throws and stops at the very first
unreachable tile it finds in raster order (`(45,0)`) and never reports
anything after that.

Once item 2 below (dungeon-interior Check Map) was built and run
against `superBossFiveMap` directly (outside the test framework, so
nothing stops early), it reported **558 of the dungeon's 650 walkable
tiles unreachable from the door** - and critically, **`(49,0)`, the
`guardian` tile itself, is one of them**. This isn't a cosmetic stray
tile next to the fight - as currently painted, `superBossFive`'s
dungeon is unwinnable: the guardian can't be reached at all. Still
Timothy's map content to fix, not a code bug, but he should know it's
"this dungeon's connectivity is broken throughout," not "repaint one
corner near the guardian."

## What to build next, in the order Timothy asked for

All four of these were requested live in the same session that produced
`9fd20cf`. He confirmed he wants #1 and #4 built; #2 and #3 came from
his very next message and weren't explicitly reconfirmed after that,
but read as clear go-aheads in context ("also need to have a check map
in these dungeons," "sounds good," "let's do this"). Ask him to
re-confirm priority order if anything's ambiguous, but don't re-litigate
whether these are wanted — that part's settled.

### 1. Order-independent tool-progression checking

**Confirmed: "This sounds good. Let's do this."**

`tools/terrain-painter/reachability.js`'s `checkProgression()` currently
takes an *ordered* `entrances` array (see
`tools/terrain-painter/painter.js`'s `checkMap()`, which hardcodes
`axe → pick → canoe → portal → dragon`) and fails if that exact stage
order doesn't work — even if a *different* order would succeed. Timothy
wants this generalized: "maybe the tool order might be different in the
future or you have different tools so it should just check if you can
get the tools and then if you can get them then the order you get them
works."

The fix is a fixed-point/iterative-unlock algorithm, not a search over
permutations: start with `unlockedKinds = toollessKinds` and
`reached = floodFill(town, unlockedKinds)`. Repeat: for every
not-yet-unlocked tool dungeon, check if its entrance is in `reached`; if
so, unlock its `TOOL_UNLOCK_KINDS` and recompute `reached`. Stop when a
full pass unlocks nothing new. If every tool ends up unlocked, the
progression is sound (regardless of what order it happened in); if some
tool's dungeon never becomes reachable, report exactly which one(s) are
stuck and why (which terrain kind is blocking them — the existing
`computeFrontier` helper already gives you the blocked-edge tiles for
this).

This *replaces* `checkProgression`'s current staged-entrance-array
design, so **read `tests/terrainPainterReachability.test.js` first** —
it unit-tests the current staged behavior directly and will need
rewriting alongside the algorithm, not just left to bit-rot. `checkMap()`
in `painter.js` (the caller) will also need its `entrances` construction
and its fail-message text updated to match the new "some tools are
stuck" reporting shape instead of "stage N failed."

### 2. Dungeon-interior "Check Map" (door → guardian reachability)

Raised as: "also need to have a check map in these dungeons to make
sure someone didn't draw something you can't even get from door to
boss with." README currently says outright: "Dungeon-interior maps
don't have their own reachability check yet."

This is much simpler than the wilderness check — no tool-gating inside
a dungeon interior (palette is just `caveFloor`/`caveWall`/`exit`/
`guardian`), so it's a single `floodFillReachable` call from the
`exit`/start tile, treating `caveFloor`/`exit`/`guardian` as passable
and `caveWall` as not, then asserting the `guardian` tile is in the
reached set. Reuse `floodFillReachable` from `reachability.js` directly
— no new algorithm needed here, just a new "Check Map"-equivalent
button/handler wired to the single-map view (`currentMapKey !==
'wilderness'`), visible only when a dungeon-shaped map is loaded
(mirror `.new-dungeon-only`/`.single-map-only` class-toggling patterns
already in `index.html`/`painter.js`). This is exactly what would have
caught `superBossFive`'s bug above.

### 3. Animated visualization of the check, with a speed slider

Timothy's own words: "can you make an animation showing the map
checking for this like so we can see the path being checked. You could
even make a slider for the speed... Default it to very fast and
someone could slow it down if they want. Slider could be there next to
check button all the time." Explicitly framed as a "this would be
cool" nice-to-have, not a hard requirement — reasonable to sequence
after #1/#2 land, and reasonable to scope down (e.g. wilderness-only
first, dungeon-check animation as a fast-follow) if it's fighting for
time.

Implementation sketch: `floodFillReachable`'s BFS already processes one
tile per queue-pop — the animation is "don't run it to completion
synchronously, `requestAnimationFrame`/`setTimeout` between pops (or N
pops per frame at higher speeds) and redraw the growing `reached` set
each step." A speed slider (persistent, next to the "Check Map" button
per his request) controls the pops-per-frame or frame-interval. "Very
fast" default should probably mean "close to instant, but still
visibly animated for a moment" rather than a genuinely slow default —
use judgment, but keep it fast unless told otherwise.

### 4. Unsaved-changes indicator + export button prominence

**Confirmed: "sounds good."**

His framing: "We should have a message to save changes and the export
button glowing and maybe a button to bring you down to save it or move
the save higher up." Build:
- A live "N unsaved changes" indicator (there's already an
  `#autosaveStatus` span used for the one-time "Restored unsaved
  changes from your last session" message on load — either extend that
  or add a new persistent one that updates as edits happen).
- The `#exportAllBtn` ("Export All Changed to Files") should visually
  glow/pulse when there are unsaved changes (a CSS class toggled on
  dirty state).
- Either move the export controls higher up the page (above the big
  1200×880 canvas), or add a small "jump to export" button near the top
  that scrolls to/highlights the real one — his message left this
  either-or open, use judgment or ask.

## Explicitly deferred, do NOT build without asking

**Multiple `exit` tiles per dungeon** (one designated `startPosition`,
any tagged `exit` a valid way out). Timothy asked about this while
hitting the current `exitCount !== 1` restriction, then said "put that
in for our next pass and I'll use it in the future" — i.e., record it,
don't build it now. It's already recorded in `docs/superpowers/BACKLOG.md`'s
2026-09-13 entry, including the confirmed finding that this is purely
an editor-side restriction (`painter.js`'s `exitCount !== 1` check) —
`js/main.js`'s `exitMap` action handler doesn't care which specific
`exit` tile the player is on at all, so multiple exits would already
work correctly at the game-engine level today.

## Process notes for whoever picks this up

- **Versioning checklist applies** (see root `CLAUDE.md`): every commit
  touching non-doc files needs a `CHANGELOG.md` entry under
  `## [Unreleased]`, bumped into a dated PATCH version before pushing
  (this work is tooling/polish, not new game content, so PATCH not
  MINOR). Add a matching `js/data/playerChangelog.js` entry — keep it
  internal-only ("groundwork," no gameplay claim) until `superBossFive`'s
  bug is fixed and this PR actually merges, same reasoning already
  applied in the 0.35.2 entry.
- **`tools/` is never deployed** (`.github/workflows/deploy.yml`
  excludes it) — painter/server changes carry zero live-site risk, but
  still need the versioning checklist since they're non-doc files.
- **The local authoring server doesn't hot-reload.** After editing
  `tools/terrain-painter/server.js` or `painter.js`, the running
  `node tools/terrain-painter/server.js` process needs a restart, and
  any open browser tab needs a reload, before changes take effect.
  Timothy is actively using this tool live in his own browser during
  this work — coordinate with him before restarting (a restart briefly
  drops any in-flight save request) rather than doing it silently.
- **New superboss dungeons need three things wired together**, easy to
  forget one: (1) the map file itself + `js/main.js` registration (the
  "Save New Dungeon to Server" flow handles this), (2)
  `SUPER_BOSSES.<id>.dungeonMapId` in `js/data/superBosses.js` (the new
  "Hook up to superboss" dropdown handles this now, or it's a manual
  edit), and (3) `tests/superBosses.test.js`'s `SUPER_BOSS_DUNGEONS`
  map needs an import + entry added by hand for the new map to get
  structural/reachability test coverage at all — nothing currently
  automates step 3.
- **Git will warn about LF→CRLF on every `js/maps/wilderness/*.js` file**
  when staging, even ones with zero real content change — the Node
  server writes LF, git normalizes to CRLF on checkout. Harmless; check
  `git diff --stat` (not just `git status`) to see which files actually
  have content changes before worrying about it.
- The GitHub repo this local `emoji-rpg` checkout points at was renamed
  to `rpg` — `gh`/PR links resolve under `yhtomitn64/rpg`, not
  `yhtomitn64/emoji-rpg`. Not a bug if you see that.

## Opening prompt for the next session

Paste this in cold:

> Continue the terrain-painter work from
> `docs/superpowers/specs/2026-09-13-superboss-placement-terrain-painter-handoff.md`
> — read that whole file first, then PR #14
> (<https://github.com/yhtomitn64/rpg/pull/14>) for the fuller history.
> Branch `feature/superboss-expansion`, work in a worktree, don't touch
> `main`.
>
> Build item 1 (order-independent tool-progression checking) first —
> it's confirmed wanted and self-contained. Then item 2 (dungeon-interior
> Check Map) — Timothy has a real, currently-failing dungeon
> (`superBossFive`, tile 45,0 unreachable) that this would have caught,
> so it's worth prioritizing highly. Item 3 (animated check
> visualization + speed slider) is explicitly a "cool if we get to it"
> ask, sequence it after 1/2. Item 4 (unsaved-changes indicator + export
> button prominence) is small and can slot in wherever convenient.
>
> Do NOT build multi-exit-tile support — that's deliberately deferred,
> already recorded in `BACKLOG.md`.
>
> `npm run test` is at 1229/1230 right now (`superBossFive`'s map bug,
> not a code bug — Timothy needs to fix that himself in the editor, not
> something to patch programmatically). Confirm that's still the only
> failure before starting, in case something else changed underneath.
