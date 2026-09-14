const LEGEND = { '#': 'caveWall', E: 'exit', '.': 'caveFloor', G: 'guardian' };

const ROWS = [
  '##############',
  '#E.....#.....#',
  '#......#.....#',
  '#......#.....#',
  '#............#',
  '#......#.....#',
  '#......#....G#',
  '##############',
];

export const superBossOneDungeonMap = {
  id: 'superBossOneDungeon',
  legend: LEGEND,
  rows: ROWS,
  startPosition: { x: 1, y: 1 },
  // Was 0/[] (no wandering encounters at all) - raised live: "there are no
  // enemies in the super boss dungeons we should add some." Reuses
  // farSoutheast's own monster table (superBosses.js's screenId for this
  // dungeon's entrance) rather than inventing new content, same rate as
  // the mini-dungeon variants (js/maps/miniDungeons/).
  encounterChance: 0.2,
  cacheChance: 0,
  monsterTable: ['direWolf', 'spider', 'scorpion'],
  guardianMonsterId: 'superBossOne',
};
