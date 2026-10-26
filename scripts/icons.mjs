import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
const crc32 = data => { let c = 0xffffffff; for (const byte of data) { c ^= byte; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
mkdirSync('extension/icons', { recursive: true });
for (const size of [16, 48, 128]) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const distance = Math.hypot(x + .5 - size / 2, y + .5 - size / 2);
    const alpha = Math.max(0, Math.min(1, size * .48 - distance));
    const bar = y >= size * .29 && y < size * .71 && ((x >= size * .32 && x < size * .43) || (x >= size * .57 && x < size * .68));
    raw.set([...(bar ? [242, 244, 231] : [63, 83, 51]), Math.round(alpha * 255)], i);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(`extension/icons/${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
