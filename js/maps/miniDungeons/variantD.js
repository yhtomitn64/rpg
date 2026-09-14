const LEGEND = {
  '.': 'caveFloor',
  '#': 'caveWall',
  E: 'miniDungeonEntrance',
  T: 'miniDungeonTreasure',
};

const ROWS = [
  '##############',
  '#E...........#',
  '#..##.....##.#',
  '#..##.....##.#',
  '#............#',
  '#....##.##...#',
  '#....##.##...#',
  '#............#',
  '#...........T#',
  '##############',
];

export const miniDungeonVariantD = {
  id: 'miniDungeonD',
  legend: LEGEND,
  rows: ROWS,
  startPosition: { x: 1, y: 1 },
  encounterChance: 0.07,
  monsterTable: ['orc', 'wraith'],
};
