const fs = require('node:fs');
const https = require('node:https');
const unzipper = require('unzipper');
const shapefile = require('shapefile');
const turfBbox = require('@turf/bbox').default || require('@turf/bbox');
const turfBboxPolygon = require('@turf/bbox-polygon').default || require('@turf/bbox-polygon');
const turfIntersects = require('@turf/boolean-intersects').default || require('@turf/boolean-intersects');
const TargetCore = require('./core.js');

const OSM_URL = 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip';
const G = TargetCore.GRID;
const eligibleDots = new Set();

function getDotPolygon(i, j) {
  const b = TargetCore.bounds(i, j);
  return turfBboxPolygon([b.west, b.south, b.east, b.north]);
}

async function run() {
  console.log('Starting stream from OpenStreetMap data...');
  
  try {
    await new Promise((resolve, reject) => {
      https.get(OSM_URL, response => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed: ${response.statusCode}`));
        }

        const stream = response.pipe(unzipper.Parse());
        
        stream.on('entry', async entry => {
          if (entry.path.endsWith('.shp')) {
            console.log(`Found shapefile: ${entry.path}. Processing geometries...`);
            try {
              // The shapefile library can parse geometries directly from the streaming .shp file
              const source = await shapefile.open(entry);
              let result;
              let count = 0;
              
              while (!(result = await source.read()).done) {
                count++;
                if (count % 10000 === 0) process.stdout.write(`\rProcessed ${count} polygons...`);
                
                const feature = result.value;
                if (!feature.geometry) continue;

                // 1. Calculate rough bounding box to limit grid intersection checks
                const bbox = turfBbox(feature);
                
                const minI = Math.max(G.minRow, Math.floor((bbox[1] - G.minLat) / G.dotH));
                const maxI = Math.min(G.maxRow, Math.floor((bbox[3] - G.minLat) / G.dotH));
                const minJ = Math.floor((bbox[0] - G.minLon) / G.dotW);
                const maxJ = Math.floor((bbox[2] - G.minLon) / G.dotW);

                // 2. Check precise collisions only for dots within the bounding box
                for (let i = minI; i <= maxI; i++) {
                  for (let j = minJ; j <= maxJ; j++) {
                    if (j < G.minColumn || j > G.maxColumn) continue;
                    
                    const key = TargetCore.key(i, j);
                    if (eligibleDots.has(key)) continue; // Already marked as land

                    const dotPoly = getDotPolygon(i, j);
                    try {
                      if (turfIntersects(feature, dotPoly)) {
                        eligibleDots.add(key);
                      }
                    } catch (e) {
                      // Turf occasionally throws on malformed coordinate edges; safe to skip
                    }
                  }
                }
              }
              console.log(`\nFinished parsing shapefile. Found ${eligibleDots.size} land dots.`);
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            entry.autodrain();
          }
        }).on('error', reject);
      }).on('error', reject);
    });

    console.log('Compacting data...');
    const cells = Array.from(eligibleDots).map(k => {
      const [i, j] = k.split('_').map(Number);
      return { i, j };
    }).sort((a, b) => a.i - b.i || a.j - b.j);

    const ranges = [];
    for (const c of cells) {
      const last = ranges[ranges.length - 1];
      if (last && last[0] === c.i && last[2] + 1 === c.j) {
        last[2] = c.j;
      } else {
        ranges.push([c.i, c.j, c.j]);
      }
    }

    const output = {
      format: 'ebt-worldwide-ranges',
      formatVersion: 1,
      source: 'OpenStreetMap contributors (ODbL 1.0)',
      generatedAt: new Date().toISOString(),
      grid: G,
      eligibleCount: cells.length,
      ranges
    };

    fs.writeFileSync('osm-base-mask.json', JSON.stringify(output));
    console.log(`Success: Compacted ${cells.length} dots into ${ranges.length} ranges. Saved to osm-base-mask.json`);

  } catch (error) {
    console.error('Generation failed:', error);
    process.exit(1);
  }
}

run();