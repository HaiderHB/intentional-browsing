import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('extension/manifest.json'));
assert.equal(manifest.manifest_version, 3);
for (const path of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(x => x.js)]) assert.ok(existsSync(join('extension', path)), `Missing ${path}`);
for (const entry of readdirSync('extension')) if (entry.endsWith('.js')) execFileSync(process.execPath, ['--check', join('extension', entry)]);
console.log('Manifest paths and extension JavaScript syntax are valid.');
