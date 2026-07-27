const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || __dirname;
const src = path.join(dataDir, 'data.sqlite');
const backupsDir = path.join(dataDir, 'backups');

if (!fs.existsSync(src)) {
  console.error('No existe data.sqlite todavía, nada que respaldar.');
  process.exit(1);
}
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(backupsDir, `data-${stamp}.sqlite`);
fs.copyFileSync(src, dest);
console.log(`Respaldo creado en ${dest}`);
