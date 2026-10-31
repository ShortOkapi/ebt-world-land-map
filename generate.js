const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const unzipper = require('unzipper');
const shapefile = require('shapefile');
const turfBbox = require('@turf/bbox').default || require('@turf/bbox');
const turfBboxPolygon = require('@turf/bbox-polygon').default || require('@turf/bbox-polygon');
const turfIntersects = require('@turf/boolean-intersects').default || require('@turf/boolean-intersects');
const TargetCore = require('./core.js');

const OSM_URL = 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip';
const G = TargetCore.GRID;

function checkZipEnd(tail, bytes, entries) {
  // EOCD plus the longest legal ZIP comment; ZIP64's normal end records fit here too.
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== 0x06054b50 || index + 22 + tail.readUInt16LE(index + 20) !== tail.length) continue;
    if (tail.readUInt16LE(index + 4) || tail.readUInt16LE(index + 6)) break;
    let count = BigInt(tail.readUInt16LE(index + 10)), onDisk = BigInt(tail.readUInt16LE(index + 8));
    let size = BigInt(tail.readUInt32LE(index + 12)), offset = BigInt(tail.readUInt32LE(index + 16));
    const directoryEnd = BigInt(bytes - tail.length + index);
    if (count === 65535n || size === 4294967295n || offset === 4294967295n) {
      const locator = index - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50 || tail.readUInt32LE(locator + 4) || tail.readUInt32LE(locator + 16) !== 1) break;
      const relative = tail.readBigUInt64LE(locator + 8) - BigInt(bytes - tail.length);
      if (relative < 0n || relative + 56n > BigInt(locator)) break;
      const end = Number(relative);
      const length = tail.readBigUInt64LE(end + 4);
      if (tail.readUInt32LE(end) !== 0x06064b50 || length < 44n || relative + 12n + length > BigInt(locator) || tail.readUInt32LE(end + 16) || tail.readUInt32LE(end + 20)) break;
      onDisk = tail.readBigUInt64LE(end + 24); count = tail.readBigUInt64LE(end + 32);
      size = tail.readBigUInt64LE(end + 40); offset = tail.readBigUInt64LE(end + 48);
    }
    if (count === BigInt(entries) && onDisk === count && offset + size <= directoryEnd) return;
    break;
  }
  throw new Error('The downloaded ZIP is incomplete or has an invalid end directory.');
}

function addFeature(feature, dots, stats) {
  if (!feature.geometry) return;
  if (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) throw new Error('Land source contains a non-polygon geometry.');
  const bbox = turfBbox(feature);
  if (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] > bbox[2] || bbox[1] > bbox[3]) throw new Error('Land source has an invalid polygon bounding box.');
  const minI = Math.max(G.minRow, Math.floor((bbox[1] - G.minLat) / G.dotH));
  const maxI = Math.min(G.maxRow, Math.floor((bbox[3] - G.minLat) / G.dotH));
  const minJ = Math.max(G.minColumn, Math.floor((bbox[0] - G.minLon) / G.dotW));
  const maxJ = Math.min(G.maxColumn, Math.floor((bbox[2] - G.minLon) / G.dotW));
  if (minI > maxI || minJ > maxJ) return;
  if (minI === maxI && minJ === maxJ) {
    const bounds = TargetCore.bounds(minI, minJ);
    // A whole polygon strictly inside one cell needs no intersection operation.
    // Edge-touching, multi-cell and clipped-source cases retain the precise path.
    if (bbox[0] > bounds.west && bbox[2] < bounds.east && bbox[1] > bounds.south && bbox[3] < bounds.north) {
      dots.add(TargetCore.key(minI, minJ)); stats.fastPaths++; return;
    }
  }
  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) {
      const key = TargetCore.key(i, j);
      if (dots.has(key)) continue;
      const b = TargetCore.bounds(i, j);
      // A failed geometry check must not silently remove land from the new mask.
      stats.intersections++;
      if (turfIntersects(feature, turfBboxPolygon([b.west, b.south, b.east, b.north]))) dots.add(key);
    }
  }
}

async function collectLandDots(input, { onProgress = () => {} } = {}) {
  const archive = unzipper.Parse({ forceStream: true });
  let tail = Buffer.alloc(0), bytes = 0, entries = 0;
  const monitor = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length; tail = Buffer.concat([tail, chunk]).subarray(-(22 + 65535 + 56 + 20)); callback(null, chunk);
  } });
  const transfer = pipeline(input, monitor, archive);
  // The iterator and transfer are awaited below; attach a handler immediately too.
  transfer.catch(() => {});
  const dots = new Set(), stats = { shapefiles: 0, polygons: 0, fastPaths: 0, intersections: 0 };
  try {
    for await (const entry of archive) {
      entries++;
      if (!entry.path.toLowerCase().endsWith('.shp')) { entry.autodrain(); continue; }
      stats.shapefiles++;
      const source = await shapefile.open(entry);
      try {
        while (true) {
          const record = await source.read();
          if (record.done) break;
          stats.polygons++;
          addFeature(record.value, dots, stats);
          if (stats.polygons % 10000 === 0) onProgress({ ...stats, dots: dots.size });
        }
      } finally { await source.cancel(); }
    }
    await transfer;
    checkZipEnd(tail, bytes, entries);
    if (!stats.shapefiles) throw new Error('The downloaded archive contains no .shp file.');
    if (!dots.size) throw new Error('No land dots were generated; the previous mask was not replaced.');
    return { dots, stats };
  } catch (error) {
    input.destroy(error); archive.destroy(error);
    await transfer.catch(() => {});
    throw error;
  }
}

function compactDots(dots) {
  const cells = Array.from(dots, key => {
    const [i, j] = key.split('_').map(Number);
    if (!TargetCore.inBounds(i, j)) throw new Error('Generated dot is outside the legacy grid.');
    return { i, j };
  }).sort((a, b) => a.i - b.i || a.j - b.j);
  const ranges = [];
  for (const cell of cells) {
    const previous = ranges.at(-1);
    if (previous && previous[0] === cell.i && previous[2] + 1 === cell.j) previous[2] = cell.j;
    else ranges.push([cell.i, cell.j, cell.j]);
  }
  return { format: 'ebt-worldwide-ranges', formatVersion: 1,
    source: 'OpenStreetMap contributors (ODbL 1.0)', generatedAt: new Date().toISOString(),
    grid: G, eligibleCount: cells.length, ranges };
}

function saveMask(outputPath, output) {
  const tempDirectory = fs.mkdtempSync(path.join(path.dirname(outputPath), '.osm-mask-'));
  try {
    const tempFile = path.join(tempDirectory, 'mask.json');
    fs.writeFileSync(tempFile, JSON.stringify(output));
    fs.renameSync(tempFile, outputPath);
  } finally {
    try { fs.rmSync(tempDirectory, { recursive: true, force: true }); }
    catch (error) { console.warn('Could not remove temporary generation files:', error.message); }
  }
}

function downloadStream(url, { get = https.get, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = get(url, response => {
      response.once('error', reject);
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`Download failed: HTTP ${response.statusCode}`)); return;
      }
      resolve(response);
    });
    request.once('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Land download timed out while waiting for data.')));
  });
}

async function generate({ input, outputPath = path.join(__dirname, 'osm-base-mask.json'), url = OSM_URL, get, timeoutMs, onProgress } = {}) {
  const stream = input || await downloadStream(url, { get, timeoutMs });
  const { dots, stats } = await collectLandDots(stream, { onProgress });
  const output = compactDots(dots);
  saveMask(outputPath, output);
  return { output, stats };
}

if (require.main === module) {
  console.log('Downloading and checking the OSM land archive; the existing mask stays in place until completion.');
  generate({ onProgress: stats => console.log(`Processed ${stats.polygons} polygons; ${stats.dots} land dots.`) })
    .then(({ output, stats }) => console.log(`Saved ${output.eligibleCount} land dots in ${output.ranges.length} ranges; ${stats.fastPaths} single-cell fast paths.`))
    .catch(error => { console.error('Generation failed; the previous mask was retained:', error.message); process.exitCode = 1; });
}

module.exports = { addFeature, collectLandDots, compactDots, saveMask, downloadStream, generate };