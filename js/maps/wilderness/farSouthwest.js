const LEGEND = { '#': 'tree', '.': 'grass', T: 'thicket', W: 'mountainWall', '~': 'water' };

const ROWS = [
  '#.............##T###T###.#####',
  '#.............##T###T#....####',
  '#............###T###T#.....###',
  '#............###T###T.......##',
  '#...........####T###T.......##',
  '#...........####T###T........#',
  '#..........####TT###.........#',
  '#..........###TT###...........',
  '#.........###TT####...........',
  '#.........TTTT####..........WW',
  '#.........#######.........WWWW',
  '#.........######.........WWWWW',
  '#.........#####.........WWWWWW',
  '#.........####........WWWWWWW~',
  '#....................WWWWWWW~~',
  '#...................WWWWWW~~~~',
  '#..................WWWWWW~~~~~',
  '#.................WWWWWW~~~~~~',
  '#.................WWWWW~~~~~~~',
  '#.................WWWW~~~~~~~~',
  '#.................WWW~~~~~~~~~',
  '##################WWW~~~~~~~~~',
];

export const farSouthwestMap = {
  id: 'farSouthwest',
  legend: LEGEND,
  rows: ROWS,
  startPosition: { x: 15, y: 11 },
  encounterChance: 0.15,
  cacheChance: 0.03,
  miniDungeonChance: 0.005,
  monsterTable: ['direWolf', 'spider', 'scorpion'],
  neighbors: { north: 'westSouthwest', south: null, east: 'southSouthwest', west: null },
};
