(async function() {
  'use strict';
  
  const C = TargetCore, G = C.GRID;
  // Display clipping only. Never trim or renumber the source grid.
  const maxLat = L.Projection.SphericalMercator.MAX_LATITUDE;
  const firstVisibleRow = Math.max(G.minRow, Math.floor((-maxLat - G.minLat) / G.dotH));
  const lastVisibleRow = Math.min(G.maxRow, Math.floor((maxLat - G.minLat) / G.dotH));
  const map = L.map('map').setView([20, 0], 3);
  
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  const landSet = new Set();
  const includeSet = new Map();
  const excludeSet = new Map();

  try {
    const [osmRes, overridesRes] = await Promise.all([
      fetch('osm-base-mask.json'),
      fetch('manual-overrides.json')
    ]);
    
    if (!osmRes.ok || !overridesRes.ok) throw new Error('Map data unavailable.');
    const osmData = await osmRes.json();
    const overrides = await overridesRes.json();

    // Decompress ranges
    for (const [r, start, end] of osmData.ranges) {
      for (let c = start; c <= end; c++) {
        landSet.add(C.key(r, c));
      }
    }

    // Apply overrides
    for (const item of overrides.include || []) {
      const k = C.key(item.dot[0], item.dot[1]);
      includeSet.set(k, item.reason);
      landSet.add(k); // Force inclusion
    }
    for (const item of overrides.exclude || []) {
      const k = C.key(item.dot[0], item.dot[1]);
      excludeSet.set(k, item.reason);
      landSet.delete(k); // Force exclusion
    }

    let visibleCount = 0;
    for (const k of landSet) {
      const row = Number(k.split('_')[0]);
      if (row >= firstVisibleRow && row <= lastVisibleRow) visibleCount++;
    }
    document.getElementById('status').textContent = `Dataset: ${landSet.size.toLocaleString()} land dots worldwide; ${visibleCount.toLocaleString()} within this map’s latitude limits.`;
  } catch (err) {
    document.getElementById('status').textContent = 'Error loading map data.';
    console.error(err);
    return;
  }

  const TargetLayer = L.GridLayer.extend({
    createTile(coords) {
      const canvas = document.createElement('canvas');
      const size = this.getTileSize(), dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = size.x * dpr; canvas.height = size.y * dpr;
      canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
      
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      
      const b = this._tileCoordsToBounds(coords);
      const nw = map.project(b.getNorthWest(), coords.z);
      
      const i0 = Math.max(firstVisibleRow, Math.floor((b.getSouth() - G.minLat) / G.dotH));
      const i1 = Math.min(lastVisibleRow, Math.floor((b.getNorth() - G.minLat) / G.dotH));
      const j0 = Math.max(G.minColumn, Math.floor((b.getWest() - G.minLon) / G.dotW));
      const j1 = Math.min(G.maxColumn, Math.floor((b.getEast() - G.minLon) / G.dotW));

      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = C.key(i, j);
          let color = null;
          
          if (excludeSet.has(k)) color = 'rgba(225, 29, 72, 0.6)'; // Red (Exclude wins)
          else if (includeSet.has(k)) color = 'rgba(13, 148, 136, 0.6)'; // Teal (Include)
          else if (landSet.has(k)) color = 'rgba(241, 169, 131, 0.45)'; // Orange (OSM)
          
          if (!color && coords.z < 6) continue;

          const pTopLeft = map.project([Math.min(maxLat, G.minLat + (i + 1) * G.dotH), Math.max(-180, G.minLon + j * G.dotW)], coords.z).subtract(nw);
          const pBottomRight = map.project([Math.max(-maxLat, G.minLat + i * G.dotH), Math.min(180, G.minLon + (j + 1) * G.dotW)], coords.z).subtract(nw);
          const width = pBottomRight.x - pTopLeft.x;
          const height = pBottomRight.y - pTopLeft.y;

          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(pTopLeft.x, pTopLeft.y, width, height);
          }

          if (coords.z >= 6) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.2)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(pTopLeft.x, pTopLeft.y, width, height);
          }
        }
      }
      // The wrap cuts two different legacy columns. Mark that cut explicitly.
      if (coords.z >= 6) {
        ctx.strokeStyle = '#17354b'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        for (const lon of [-180, 180]) {
          const x = map.project([0, lon], coords.z).x - nw.x;
          if (x < 0 || x > size.x) continue;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
        }
      }
      return canvas;
    }
  });

  new TargetLayer({ zIndex: 10 }).addTo(map);

  map.on('click', event => {
    try {
      if (Math.abs(event.latlng.lat) > maxLat) { map.closePopup(); return; }
      const dot = C.atLatLng(event.latlng.lat, event.latlng.lng);
      const k = C.key(dot.i, dot.j);
      let status = 'Water (OSM Base)';
      let reason = '';

      if (excludeSet.has(k)) {
        status = 'Verified Water (Manual Override)';
        reason = excludeSet.get(k);
      } else if (includeSet.has(k)) {
        status = 'Verified Land (Manual Override)';
        reason = includeSet.get(k);
      } else if (landSet.has(k)) {
        status = 'Land (OSM Base)';
      }

      const content = document.createElement('div'), heading = document.createElement('h3'), description = document.createElement('p');
      heading.textContent = `[${dot.i}, ${dot.j}]`;
      const label = document.createElement('strong'); label.textContent = status; description.append(label);
      if (reason) {
        const text = document.createElement('span'); text.style.color = '#576b77'; text.textContent = reason;
        description.append(document.createElement('br'), text);
      }
      content.append(heading, description);
      L.popup().setLatLng(event.latlng).setContent(content).openOn(map);
    } catch (e) {
      // Clicked outside bounds
    }
  });
})();