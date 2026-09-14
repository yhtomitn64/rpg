const LEGEND = { '#': 'tree', '.': 'grass', W: 'mountainWall', M: 'mountain', T: 'thicket' };

const ROWS = [
  '##########....................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '.........WWWWWWWWWWWW.........',
  '........WWMMMMMMMMMTT.........',
  '.......WWMMMMMMMMMMTT.........',
  '.......WMMMM#########.........',
  '......WWMMM##########.........',
  '...WWWWMMM#######.............',
  'WWWWMMMMMM#####...............',
  'WWWW.MMMM######............###',
  'WWWWMMMMM######............##.',
  'WWWWWWWMMM#####...............',
  'W.....WMMMMM###...............',
  '......WMMMMM########..........',
  '......WWWWMMM#######..........',
  '.........WMMMMM######.........',
  '.........WWMMMMMMM###.........',
  '..........WWWMMMMM###.........',
  '............WWWWMMM##.........',
];

export const northNortheastMap = {
  id: 'northNortheast',
  legend: LEGEND,
  rows: ROWS,
  startPosition: { x: 15, y: 11 },
  encounterChance: 0.05,
  cacheChance: 0.03,
  miniDungeonChance: 0.005,
  monsterTable: ['direWolf', 'spider', 'scorpion'],
  neighbors: { north: null, south: 'northeast', east: 'farNortheast', west: 'farNorth' },
};
