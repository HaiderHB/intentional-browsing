import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
const files = {};
function walk(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, item.name); if (item.isDirectory()) walk(path); else files[relative('extension', path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path)); } }
walk('extension');
mkdirSync('dist', { recursive: true });
const version = JSON.parse(readFileSync('extension/manifest.json')).version;
const output = `dist/intentional-${version}.zip`;
writeFileSync(output, zipSync(files, { level: 9 }));
console.log(`Created ${output} (${Object.keys(files).length} files; no dependencies bundled).`);
