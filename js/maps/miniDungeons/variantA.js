const LEGEND = {
  '.': 'caveFloor',
  '#': 'caveWall',
  '~': 'cavePool',
  E: 'miniDungeonEntrance',
  T: 'miniDungeonTreasure',
};

const ROWS = [
  '##############',
  '#E...........#',
  '#............#',
  '#..##....##..#',
  '#..##....##..#',
  '#............#',
  '#....~~......#',
  '#....~~....T.#',
  '#............#',
  '##############',
];

export const miniDungeonVariantA = {
  id: 'miniDungeonA',
  legend: LEGEND,
  rows: ROWS,
  startPosition: { x: 1, y: 1 },
  encounterChance: 0.07,
  monsterTable: ['orc', 'wraith'],
};
