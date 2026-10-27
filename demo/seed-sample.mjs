// Seed a disposable workspace with the public sample candidate.
// The sample is fictional: jsonresume/resume-schema sample.resume.json (MIT).
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const index = process.argv.indexOf('--data-root');
const root = path.resolve(index < 0 ? path.join(process.env.TMPDIR || '/tmp', 'plainhand-sample') : process.argv[index + 1]);
await mkdir(path.join(root, 'config'), { recursive: true });
await cp(path.join(here, 'sample-candidate/profile.yml'), path.join(root, 'config/profile.yml'));
await cp(path.join(here, 'sample-candidate/cv.md'), path.join(root, 'cv.md'));
console.log(`Sample candidate seeded at ${root}`);
console.log('Next: point the app at this workspace, or run node demo/run-sample.mjs --data-root ' + root);
