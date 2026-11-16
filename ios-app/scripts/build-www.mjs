// Copies the web app's files from the repo root into ios-app/www (Capacitor's webDir).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = join(dirname(fileURLToPath(import.meta.url)), '..'), root = join(here, '..'), out = join(here, 'www');
const files = ['index.html', 'manifest.json', 'gs-logo.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const f of files) { if (!existsSync(join(root, f))) { console.error('missing ' + f); process.exit(1); } cpSync(join(root, f), join(out, f)); }
console.log('www/ ready: ' + files.join(', '));
