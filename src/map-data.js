/*
 * Deterministic demo map dataset.
 * World coordinates are meters, origin top-left, x right, y down.
 * Shared by the browser UI and the Node export/verify tooling.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MapData = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD = { width: 20000, height: 15000 };

  const terrainStyles = {
    highland: { fill: '#d8c28a', stroke: '#8a6d3b', label: 'Highland' },
    lowland: { fill: '#cfe3b0', stroke: '#6f8f4e', label: 'Lowland' },
    wetland: { fill: '#b9d8c7', stroke: '#4e7d63', label: 'Wetland' },
    upland: { fill: '#e6d5a7', stroke: '#9c7b45', label: 'Upland' },
  };

  const terrain = [
    {
      id: 't-highland',
      type: 'highland',
      label: 'North Highland',
      labelAt: [6500, 2600],
      polygon: [
        [0, 0], [12500, 0], [12500, 2600], [11800, 4300],
        [9000, 5200], [5200, 5000], [2000, 4200], [0, 3000],
      ],
    },
    {
      id: 't-upland',
      type: 'upland',
      label: 'East Upland',
      labelAt: [16500, 3500],
      polygon: [
        [12500, 0], [20000, 0], [20000, 5000], [17500, 4800],
        [15000, 4200], [12500, 2600],
      ],
    },
    {
      id: 't-lowland',
      type: 'lowland',
      label: 'Central Lowland',
      labelAt: [9500, 7500],
      polygon: [
        [0, 3000], [2000, 4200], [5200, 5000], [9000, 5200],
        [11800, 4300], [12500, 2600], [15000, 4200], [14500, 7000],
        [12000, 9500], [7000, 10000], [3000, 9000], [0, 7500],
      ],
    },
    {
      id: 't-wetland',
      type: 'wetland',
      label: 'Southern Wetland',
      labelAt: [10500, 12500],
      polygon: [
        [0, 7500], [3000, 9000], [7000, 10000], [12000, 9500],
        [14500, 7000], [17500, 4800], [20000, 5000], [20000, 15000],
        [0, 15000],
      ],
    },
  ];

  const water = [
    {
      id: 'w-lake',
      kind: 'lake',
      name: 'Mirror Lake',
      labelAt: [5400, 6650],
      polygon: [
        [4000, 5600], [5600, 5300], [7000, 5900], [7200, 7200],
        [6200, 8100], [4600, 7900], [3700, 6900],
      ],
    },
    {
      id: 'w-river',
      kind: 'river',
      name: 'Jade River',
      width: 180,
      line: [
        [1200, 15000], [2600, 12800], [4200, 11200], [6000, 10500],
        [8200, 10800], [10500, 9800], [12500, 8200], [14200, 6000],
        [15800, 3500], [18000, 1200], [19600, 0],
      ],
    },
    {
      id: 'w-tributary',
      kind: 'river',
      name: 'Cedar Brook',
      width: 90,
      line: [
        [12000, 15000], [11500, 12500], [10500, 9800],
      ],
    },
  ];

  const roads = [
    {
      id: 'r-g101',
      kind: 'trunk',
      name: 'G101 Trunk',
      width: 260,
      line: [
        [0, 8500], [3000, 8000], [6000, 7600], [9000, 7200],
        [12000, 6500], [15000, 5500], [18000, 4800], [20000, 4500],
      ],
    },
    {
      id: 'r-r202',
      kind: 'secondary',
      name: 'R202',
      width: 160,
      line: [
        [7000, 0], [7200, 3000], [7600, 5500], [8200, 8000],
        [9000, 10500], [9800, 13000], [10500, 15000],
      ],
    },
    {
      id: 'r-r303',
      kind: 'secondary',
      name: 'R303',
      width: 140,
      line: [
        [0, 11500], [4000, 11200], [8000, 11800], [12000, 11500],
        [16000, 10800], [20000, 11000],
      ],
    },
    {
      id: 'r-lane',
      kind: 'minor',
      name: 'Mill Lane',
      width: 80,
      dash: [300, 260],
      line: [
        [3000, 8000], [3500, 5500], [4500, 3500], [6000, 2000],
      ],
    },
  ];

  const towns = [
    { id: 'town-1', name: 'Millbrook', at: [2600, 3600] },
    { id: 'town-2', name: 'Oakdale', at: [8600, 4400] },
    { id: 'town-3', name: 'Riverton', at: [9800, 8700] },
    { id: 'town-4', name: 'Lakeside', at: [7600, 7000] },
    { id: 'town-5', name: 'Westfield', at: [3200, 10600] },
    { id: 'town-6', name: 'Pinehaven', at: [15800, 7600] },
    { id: 'town-7', name: 'Southport', at: [13200, 12600] },
  ];

  return { WORLD, terrainStyles, terrain, water, roads, towns };
});
