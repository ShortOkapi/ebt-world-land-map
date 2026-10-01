/* MIT. Shared grid mathematics for EBT Dot Safari. */
(function (root) {
  'use strict';
  
  const GRID = Object.freeze({
    id: 'ebt-dot-safari-legacy-v1',
    dotH: 0.28,
    dotW: 66/157,
    minLat: -89.72,
    minLon: -(178+140/157),
    longitudeWrap: 360,
    minColumn: -3,
    maxColumn: 853,
    minRow: 0,
    maxRow: 641
  });

  const key = (i, j) => `${i}_${j}`;
  
  const canonicalLongitude = lon => ((lon + 180) % 360 + 360) % 360 - 180;
  
  const inBounds = (i, j) => 
    Number.isSafeInteger(i) && Number.isSafeInteger(j) && 
    i >= GRID.minRow && i <= GRID.maxRow && 
    j >= GRID.minColumn && j <= GRID.maxColumn;

  function bounds(i, j) {
    return {
      south: GRID.minLat + i * GRID.dotH,
      north: GRID.minLat + (i + 1) * GRID.dotH,
      west: GRID.minLon + j * GRID.dotW,
      east: GRID.minLon + (j + 1) * GRID.dotW
    };
  }

  function atLatLng(lat, lon) {
    const i = Math.floor((lat - GRID.minLat) / GRID.dotH);
    const j = Math.floor((canonicalLongitude(lon) - GRID.minLon) / GRID.dotW);
    if (!inBounds(i, j)) throw Error('This position is outside the grid.');
    return { i, j };
  }

  root.TargetCore = { GRID, key, canonicalLongitude, inBounds, bounds, atLatLng };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TargetCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);