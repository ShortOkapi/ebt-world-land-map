const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), http = require('node:http');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const generator = require('../generate.js'), C = require('../core.js');
const turfBbox = require('@turf/bbox').default || require('@turf/bbox');
const bboxPolygon = require('@turf/bbox-polygon').default || require('@turf/bbox-polygon');
const intersects = require('@turf/boolean-intersects').default || require('@turf/boolean-intersects');
const checks = [], servers = new Set();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ebt-generator-check-'));
const deadline = setTimeout(() => { console.error('Generator checks did not complete within 30 seconds.'); process.exit(1); }, 30000);
const pass = name => { checks.push(name); console.log('PASS', name); };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files, deflate = false) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of files) {
    const bytes = Buffer.from(data), packed = deflate ? zlib.deflateRawSync(bytes) : bytes, filename = Buffer.from(name), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14);
    header.writeUInt16LE(deflate ? 8 : 0, 8); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, packed);
    const descriptor = Buffer.alloc(46); descriptor.writeUInt32LE(0x02014b50); descriptor.writeUInt16LE(20, 4); descriptor.writeUInt16LE(20, 6);
    descriptor.writeUInt16LE(deflate ? 8 : 0, 10); descriptor.writeUInt32LE(crc, 16); descriptor.writeUInt32LE(packed.length, 20); descriptor.writeUInt32LE(bytes.length, 24);
    descriptor.writeUInt16LE(filename.length, 28); descriptor.writeUInt32LE(offset, 42); central.push(descriptor, filename);
    offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function shp(rings) {
  const records = [];
  for (const [index, ring] of rings.entries()) {
    const body = Buffer.alloc(48 + ring.length * 16), header = Buffer.alloc(8);
    body.writeInt32LE(5); const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((n, i) => body.writeDoubleLE(n, 4 + i * 8));
    body.writeInt32LE(1, 36); body.writeInt32LE(ring.length, 40); body.writeInt32LE(0, 44);
    ring.forEach(([x, y], i) => { body.writeDoubleLE(x, 48 + i * 16); body.writeDoubleLE(y, 56 + i * 16); });
    header.writeInt32BE(index + 1); header.writeInt32BE(body.length / 2, 4); records.push(header, body);
  }
  const header = Buffer.alloc(100), rest = Buffer.concat(records); header.writeInt32BE(9994); header.writeInt32BE((100 + rest.length) / 2, 24);
  header.writeInt32LE(1000, 28); header.writeInt32LE(5, 32);
  if (rings.length) {
    const points = rings.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((n, i) => header.writeDoubleLE(n, 36 + i * 8));
  }
  return Buffer.concat([header, rest]);
}
const rectangle = (w, s, e, n) => [[w, s], [w, n], [e, n], [e, s], [w, s]];
const b = C.bounds(459, 403), tiny = rectangle(b.west + .05, b.south + .05, b.west + .06, b.south + .06);
const feature = ring => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
const validZip = zip([['readme.txt', Buffer.alloc(128 * 1024, 65)], ['land.shp', shp([tiny])], ['land.prj', 'WGS84']]);
function reference(value) {
  const box = turfBbox(value), dots = new Set(), G = C.GRID;
  for (let i = Math.max(G.minRow, Math.floor((box[1] - G.minLat) / G.dotH)); i <= Math.min(G.maxRow, Math.floor((box[3] - G.minLat) / G.dotH)); i++) {
    for (let j = Math.max(G.minColumn, Math.floor((box[0] - G.minLon) / G.dotW)); j <= Math.min(G.maxColumn, Math.floor((box[2] - G.minLon) / G.dotW)); j++) {
      const c = C.bounds(i, j); if (intersects(value, bboxPolygon([c.west, c.south, c.east, c.north]))) dots.add(C.key(i, j));
    }
  }
  return [...dots].sort();
}
const outputPath = path.join(root, 'mask.json'), sentinel = 'previous valid mask retained';
async function rejectsWithoutReplacement(input, pattern) {
  fs.writeFileSync(outputPath, sentinel);
  await assert.rejects(generator.generate({ input, outputPath }), pattern);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
}
async function serverFor(handler) {
  const server = http.createServer(handler); servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port + '/land.zip';
}

(async () => {
  const dots = new Set(), stats = { fastPaths: 0, intersections: 0 };
  generator.addFeature(feature(tiny), dots, stats);
  assert.deepEqual([...dots], ['459_403']); assert.deepEqual(stats, { fastPaths: 1, intersections: 0 });
  pass('a strictly interior single-cell polygon uses the fast path without Turf intersections');
  const fixtures = [feature(tiny), feature(rectangle(b.west, b.south + .05, b.west + .06, b.south + .06)),
    feature(rectangle(b.east - .02, b.north - .02, b.east + .02, b.north + .02)),
    feature(rectangle(b.west + .01, b.south, b.west + .02, b.north)),
    feature(rectangle(-180, 0, -179.98, .01)), feature(rectangle(179.98, 0, 180, .01)),
    feature(rectangle(0, -89.8, .01, -89.7)),
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[tiny], [rectangle(b.east + .03, b.south + .03, b.east + .04, b.south + .04)]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [tiny, rectangle(b.west + .052, b.south + .052, b.west + .054, b.south + .054).reverse()] } }];
  for (const value of fixtures) {
    const result = new Set(); generator.addFeature(value, result, { fastPaths: 0, intersections: 0 }); assert.deepEqual([...result].sort(), reference(value));
  }
  pass('fast and precise paths agree with the previous Turf rule on interiors, cell edges, multi-cell polygons, holes and multipolygons');
  const compact = generator.compactDots(new Set(['2_4', '1_3', '2_2', '2_3']));
  assert.deepEqual(compact.ranges, [[1, 3, 3], [2, 2, 4]]); assert.equal(compact.eligibleCount, 4); assert.deepEqual(compact.grid, C.GRID);
  assert.throws(() => generator.compactDots(new Set(['-1_0'])));
  pass('compaction keeps the legacy grid, sorted merged ranges and exact dot count');
  let result = await generator.generate({ input: Readable.from([validZip]), outputPath });
  assert.deepEqual(result.output.ranges, [[459, 403, 403]]); assert.equal(result.stats.shapefiles, 1);
  assert.equal(JSON.parse(fs.readFileSync(outputPath)).eligibleCount, 1);
  pass('a real ZIP/SHP stream drains non-shapefile entries and writes only after complete processing');
  const deflated = zip([['readme.txt', Buffer.alloc(128 * 1024, 65)], ['land.shp', shp([tiny])]], true);
  const chunks = []; for (let n = 0; n < deflated.length; n += 7) chunks.push(deflated.subarray(n, n + 7));
  result = await generator.collectLandDots(Readable.from(chunks)); assert.deepEqual([...result.dots], ['459_403']);
  pass('deflated ZIP entries work across small stream chunk boundaries');
  const comment = Buffer.from('Valid ZIP comment'), commented = Buffer.from(validZip);
  commented.writeUInt16LE(comment.length, commented.length - 2);
  result = await generator.collectLandDots(Readable.from([Buffer.concat([commented, comment])])); assert.equal(result.dots.size, 1);
  pass('a complete ZIP may include its legal end comment');
  const legacyEnd = Buffer.from(validZip.subarray(-22)), zip64 = Buffer.alloc(56), locator = Buffer.alloc(20);
  zip64.writeUInt32LE(0x06064b50); zip64.writeBigUInt64LE(44n, 4); zip64.writeUInt16LE(45, 12); zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(3n, 24); zip64.writeBigUInt64LE(3n, 32); zip64.writeBigUInt64LE(BigInt(legacyEnd.readUInt32LE(12)), 40); zip64.writeBigUInt64LE(BigInt(legacyEnd.readUInt32LE(16)), 48);
  locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(validZip.length - 22), 8); locator.writeUInt32LE(1, 16);
  legacyEnd.writeUInt16LE(65535, 8); legacyEnd.writeUInt16LE(65535, 10); legacyEnd.writeUInt32LE(0xffffffff, 12); legacyEnd.writeUInt32LE(0xffffffff, 16);
  result = await generator.collectLandDots(Readable.from([Buffer.concat([validZip.subarray(0, -22), zip64, locator, legacyEnd])])); assert.equal(result.dots.size, 1);
  pass('a complete ZIP64 end directory is accepted without buffering the full archive');
  const longestComment = Buffer.alloc(65535, 65); legacyEnd.writeUInt16LE(longestComment.length, 20);
  result = await generator.collectLandDots(Readable.from([Buffer.concat([validZip.subarray(0, -22), zip64, locator, legacyEnd, longestComment])])); assert.equal(result.dots.size, 1);
  pass('a normal ZIP64 end directory also supports the maximum legal ZIP comment');
  const another = rectangle(b.east + .03, b.south + .03, b.east + .04, b.south + .04);
  result = await generator.collectLandDots(Readable.from([zip([['one.shp', shp([tiny])], ['two.SHP', shp([another])]])]));
  assert.equal(result.stats.shapefiles, 2); assert.deepEqual([...result.dots].sort(), ['459_403', '459_404']);
  pass('multiple shapefiles, including uppercase extensions, are processed sequentially');
  await rejectsWithoutReplacement(Readable.from([zip([['README.txt', 'no shapes here']])]), /no \.shp/i);
  pass('an archive with no shapefile rejects promptly and retains the previous mask');
  await rejectsWithoutReplacement(Readable.from([zip([['bad.shp', Buffer.from('not a shapefile')]])]));
  pass('invalid shapefile data rejects and retains the previous mask');
  await rejectsWithoutReplacement(Readable.from([zip([['first.shp', shp([tiny])], ['later.shp', Buffer.from('not a shapefile')]])]));
  pass('a later shapefile failure cannot publish the earlier successful partial result');
  await rejectsWithoutReplacement(Readable.from([validZip.subarray(0, validZip.length - 30)]));
  pass('a truncated ZIP rejects and retains the previous mask');
  await rejectsWithoutReplacement(Readable.from((async function* () { yield validZip.subarray(0, 60); throw new Error('Synthetic interrupted stream'); })()), /interrupted stream/);
  pass('an interrupted source stream propagates its error and retains the previous mask');
  await rejectsWithoutReplacement(Readable.from([zip([['empty.shp', shp([])]])]), /No land dots/i);
  pass('an empty shapefile cannot replace the worldwide mask with an empty result');
  for (const geometry of [{ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'Polygon', coordinates: [] }]) {
    assert.throws(() => generator.addFeature({ geometry }, new Set(), { fastPaths: 0, intersections: 0 }));
  }
  pass('non-polygon and non-finite/empty polygon bounds fail instead of silently losing land');
  fs.writeFileSync(outputPath, sentinel);
  let url = await serverFor((req, res) => { res.writeHead(404); res.end('missing'); });
  await assert.rejects(generator.generate({ url, get: http.get, outputPath }), /HTTP 404/); assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
  pass('HTTP failure stops before replacing the previous mask');
  url = await serverFor((req, res) => { res.writeHead(500); res.write('partial error response'); setImmediate(() => res.destroy()); });
  await assert.rejects(generator.generate({ url, get: http.get, outputPath })); assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
  pass('an interrupted HTTP error response is handled without an uncaught stream error');
  url = await serverFor(() => {});
  await assert.rejects(generator.generate({ url, get: http.get, timeoutMs: 50, outputPath }), /timed out/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
  pass('a stalled response-header download times out and retains the previous mask');
  url = await serverFor((req, res) => { res.writeHead(200); res.write(validZip.subarray(0, 60)); });
  await assert.rejects(generator.generate({ url, get: http.get, timeoutMs: 50, outputPath })); assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
  pass('a stalled response body times out through the ZIP pipeline and retains the previous mask');
  url = await serverFor((req, res) => { res.writeHead(200); res.write(validZip.subarray(0, 60)); setImmediate(() => res.destroy()); });
  await assert.rejects(generator.generate({ url, get: http.get, outputPath })); assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
  pass('a dropped HTTP body cannot be mistaken for successful generation');
  url = await serverFor((req, res) => { res.writeHead(200); res.end(validZip); });
  result = await generator.generate({ url, get: http.get, outputPath }); assert.equal(result.output.eligibleCount, 1);
  pass('a complete HTTP fixture processes and atomically replaces the chosen output file');
  fs.writeFileSync(outputPath, sentinel); const originalRename = fs.renameSync;
  try { fs.renameSync = () => { throw new Error('Synthetic rename failure'); }; assert.throws(() => generator.saveMask(outputPath, compact), /rename failure/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel); assert.deepEqual(fs.readdirSync(root), ['mask.json']);
  pass('a failed final rename retains the original file and cleans temporary output');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../osm-base-mask.json'))), overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '../manual-overrides.json')));
  assert.ok(Array.isArray(overrides.include) && Array.isArray(overrides.exclude));
  assert.ok(![...overrides.include, ...overrides.exclude].some(item => /^Example of /.test(item.reason || '')));
  const all = new Set(); for (const [i, first, last] of base.ranges) for (let j = first; j <= last; j++) all.add(C.key(i, j));
  assert.equal(all.size, base.eligibleCount); assert.ok(all.has('10_10'));
  pass('the shipped base count is consistent and live overrides contain no placeholder example decisions');
  const child = execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(__dirname, '../generate.js')) + ');console.log("import-only")'], { encoding: 'utf8' });
  assert.equal(child.trim(), 'import-only');
  pass('importing the generator does not start a real download');
  const version = require('../package.json').version;
  assert.ok(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').includes('v' + version + '</span>'));
  pass('the viewer and package identify the same source candidate version');
  console.log(JSON.stringify({ generatorChecks: checks.length, checks }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(root, { recursive: true, force: true }); clearTimeout(deadline);
});
