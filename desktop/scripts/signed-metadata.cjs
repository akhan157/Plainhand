// Authenticode changes the installer bytes. Never publish pre-signing hashes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const folder = path.resolve(__dirname, '../signed-installer');
const files = fs.readdirSync(folder).filter(name => name.endsWith('.exe'));
if (files.length !== 1) throw new Error('Expected exactly one signed Windows installer');
const filename = files[0], buffer = fs.readFileSync(path.join(folder, filename));
const sha512 = createHash('sha512').update(buffer).digest('base64');
// JSON is valid YAML. Differential packages are disabled for post-signing builds.
fs.writeFileSync(path.join(folder, 'latest.yml'), JSON.stringify({ version, files: [{ url: filename, sha512, size: buffer.length }], path: filename, sha512, releaseDate: new Date().toISOString() }, null, 2));
