(async function() {
  'use strict';
  
  const C = TargetCore, G = C.GRID;
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

    document.getElementById('status').textContent = `Loaded ${landSet.size.toLocaleString()} worldwide land dots.`;
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
      
      const i0 = Math.floor((b.getSouth() - G.minLat) / G.dotH);
      const i1 = Math.floor((b.getNorth() - G.minLat) / G.dotH);
      const j0 = Math.floor((b.getWest() - G.minLon) / G.dotW);
      const j1 = Math.floor((b.getEast() - G.minLon) / G.dotW);

      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = C.key(i, j);
          let color = null;
          
          if (includeSet.has(k)) color = 'rgba(13, 148, 136, 0.6)'; // Teal (Include)
          else if (excludeSet.has(k)) color = 'rgba(225, 29, 72, 0.6)'; // Red (Exclude)
          else if (landSet.has(k)) color = 'rgba(241, 169, 131, 0.45)'; // Orange (OSM)
          
          if (!color && coords.z < 6) continue;

          const pTopLeft = map.project([G.minLat + (i + 1) * G.dotH, G.minLon + j * G.dotW], coords.z).subtract(nw);
          const pBottomRight = map.project([G.minLat + i * G.dotH, G.minLon + (j + 1) * G.dotW], coords.z).subtract(nw);
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
      return canvas;
    }
  });

  new TargetLayer({ zIndex: 10 }).addTo(map);

  map.on('click', event => {
    try {
      const dot = C.atLatLng(event.latlng.lat, event.latlng.lng);
      const k = C.key(dot.i, dot.j);
      let status = 'Water (OSM Base)';
      let reason = '';

      if (includeSet.has(k)) {
        status = 'Verified Land (Manual Override)';
        reason = includeSet.get(k);
      } else if (excludeSet.has(k)) {
        status = 'Verified Water (Manual Override)';
        reason = excludeSet.get(k);
      } else if (landSet.has(k)) {
        status = 'Land (OSM Base)';
      }

      const reasonHtml = reason ? `<br><span style="color:#576b77">${reason}</span>` : '';
      L.popup()
        .setLatLng(event.latlng)
        .setContent(`<h3>[${dot.i}, ${dot.j}]</h3><p><strong>${status}</strong>${reasonHtml}</p>`)
        .openOn(map);
    } catch (e) {
      // Clicked outside bounds
    }
  });
})();