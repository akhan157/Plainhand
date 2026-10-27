// Exercise the read-only parts of the pipeline with the sample candidate:
// context assembly, live posting verification, and live discovery.
import path from 'node:path';
import { Workspace } from '../plainhand/store.mjs';
import { discover, verifyJob } from '../plainhand/jobs.mjs';

const index = process.argv.indexOf('--data-root');
const root = path.resolve(index < 0 ? path.join(process.env.TMPDIR || '/tmp', 'plainhand-sample') : process.argv[index + 1]);
const workspace = new Workspace(root);
const state = await workspace.load();
const context = await workspace.context(state);

console.log('Profile:', state.profile.name, '|', state.profile.roles, '|', state.profile.location);
console.log('Context sources:', context.sources.map(source => `${source.id} (${source.text.length} chars)`).join(', '));
console.log('Context hash:', context.hash.slice(0, 16));

const jobs = await discover({ name: 'Zoox', url: 'https://jobs.lever.co/zoox' }, '', '');
const posting = jobs[0];
console.log(`Discovery: ${jobs.length} roles, first = ${posting.title} (${posting.location})`);

const verification = await verifyJob({ id: 'sample-job', url: posting.url, title: posting.title, description: '' });
console.log('Verification:', verification.state, '|', verification.reason);
