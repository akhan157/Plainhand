// Local loopback portals for the U08 site tests. Each ATS keeps its real public
// hostname and path grammar; Chromium resolves those names to this HTTPS server
// with --host-resolver-rules, so the product's own host detection, guards and
// upload policy run unchanged. Nothing leaves the machine. Never used by the app.
import https from 'node:https';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const run = promisify(execFile);

export const ACCESS_TIER = 'local-fixture';
export const FIXTURE_HOSTS = {
  greenhouse: 'boards.greenhouse.io',
  lever: 'jobs.lever.co',
  ashby: 'jobs.ashbyhq.com',
  workday: 'acme.wd5.myworkdayjobs.com',
  linkedin: 'www.linkedin.com',
  indeed: 'www.indeed.com',
  unknown: 'careers.acme-u08.invalid',
};
export const FIXTURE_PATHS = {
  greenhouse: { board: '/acme/jobs/1234', apply: '/acme/jobs/1234/apply' },
  greenhousePlanted: { board: '/acme/jobs/4040', apply: '/acme/jobs/4040/apply' },
  lever: { board: '/acme/9f8e7d6c-1234-4abc-8def-0123456789ab', apply: '/acme/9f8e7d6c-1234-4abc-8def-0123456789ab/apply' },
  ashby: { apply: '/acme/9f8e7d6c-1234-4abc-8def-0123456789ab/application' },
  workday: { board: '/en-US/acme/job/Boston/Graduate-Engineer_R-123', apply: '/en-US/acme/apply/autofillWithResume', login: '/en-US/acme/login' },
  linkedin: { board: '/jobs/view/4401234567/' },
  indeed: { board: '/viewjob?jk=u08fixture' },
  unknown: { board: '/jobs/graduate-engineer' },
};
export const fixtureUrl = (kind, key = 'board') => `https://${FIXTURE_HOSTS[kind]}${FIXTURE_PATHS[kind][key]}`;

const COMPANY = 'Acme Robotics';
const ROLE = 'Graduate Mechanical Engineer';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>
  :root{color-scheme:light}body{font:16px/1.55 system-ui,Segoe UI,Arial;margin:40px auto;max-width:720px;color:#22302a;background:#f7f8f5;padding:0 20px}
  h1{font-size:30px;line-height:1.2;margin:0 0 6px}h2{margin-top:28px}.meta{color:#55665a;margin:0 0 24px}
  .field{margin:18px 0}label{display:block;font-weight:600;margin-bottom:6px}input,textarea,select{display:block;width:100%;padding:10px;box-sizing:border-box;border:1px solid #bdc9b4;border-radius:4px;background:#fff;font:inherit}
  input[type=checkbox],input[type=radio]{width:auto;display:inline;margin-right:6px}textarea{min-height:110px}
  fieldset{border:1px solid #d7dfd2;padding:12px 16px;margin:18px 0;border-radius:4px}legend{font-weight:600;padding:0 4px}
  button{background:#244c35;color:#fff;padding:12px 24px;border:0;border-radius:4px;font:inherit;cursor:pointer}button:hover{background:#1c3d2a}
  .fixture-note{margin-top:40px;color:#7a8b7f;font-size:13px;border-top:1px solid #d7dfd2;padding-top:12px}
  .download-row a{display:inline-block;margin-right:8px}
  </style></head><body>${body}<p class="fixture-note">LOCAL LOOPBACK FIXTURE — NOT A REAL EMPLOYER. No request leaves this machine.</p>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

const submitScript = formId => `window.submissions=0;window.submitted=false;document.getElementById('${formId}').addEventListener('submit',function(){window.submissions++;window.submitted=true;});window.__plainhandPlantSubmit=function(){var button=document.querySelector('#${formId} button[type="submit"]');button.click();};`;

const greenhouseBoard = () => page(`${ROLE} at ${COMPANY}`, `<header><strong>${COMPANY}</strong></header><main id="app_body"><h1>${ROLE}</h1><p class="meta">Boston, MA · Full-time · Hardware</p><p>Design, build and physically test lightweight chassis components with the vehicle team. Own a subsystem from drawing to test report.</p><a href="${FIXTURE_PATHS.greenhouse.board}/apply">Apply for this job</a></main>`);

const greenhouseApply = ({ planted = false } = {}) => page(`Apply: ${ROLE} — ${COMPANY}`, `<h1>${ROLE}</h1><p class="meta">${COMPANY} · Boston, MA</p>
<form id="application_form" action="/submit/greenhouse" method="post" enctype="multipart/form-data">
  <div class="field"><label for="first_name">First name</label><input id="first_name" name="job_application[first_name]" type="text" autocomplete="given-name" required></div>
  <div class="field"><label for="last_name">Last name</label><input id="last_name" name="job_application[last_name]" type="text" autocomplete="family-name" required></div>
  <div class="field"><label for="email">Email</label><input id="email" name="job_application[email]" type="email" autocomplete="email" required></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" name="job_application[phone]" type="tel" autocomplete="tel"></div>
  <div class="field"><label for="resume">Resume/CV</label><input id="resume" name="job_application[resume]" type="file" accept=".pdf,.doc,.docx" required></div>
  <div class="field"><label for="cover_letter">Cover letter</label><input id="cover_letter" name="job_application[cover_letter]" type="file" accept=".pdf,.doc,.docx"></div>
  <div class="field"><label for="linkedin">LinkedIn profile</label><input id="linkedin" name="job_application[urls][LinkedIn]" type="url"></div>
  <div class="field"><label for="project">Describe a relevant project.</label><textarea id="project" name="job_application[answers][project]"></textarea></div>
  <div class="field"><label for="sponsorship">Will you now or in the future require sponsorship?</label><select id="sponsorship" name="job_application[sponsorship]"><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></div>
  ${planted ? '<div class="field"><label for="portfolio">Portfolio URL</label><input id="portfolio" name="job_application[portfolio]" type="url" required></div>' : ''}
  <div class="field"><label><input type="checkbox" name="job_application[attestation]" value="1"> I certify that the information in this application is accurate.</label></div>
  <button type="submit">Submit application</button>
</form>`, submitScript('application_form'));

const leverBoard = () => page(`${COMPANY} - ${ROLE}`, `<div class="posting-page"><h1>${ROLE}</h1><p class="posting-categories">${COMPANY} · Boston, MA · Full-time</p><div class="section page-centered"><p>Join the vehicle team to design and physically test chassis components.</p><a class="postings-btn template-btn-submit" href="${FIXTURE_PATHS.lever.board}/apply">Apply for this job</a></div></div>`);

const leverApply = () => page(`Apply: ${ROLE} — ${COMPANY}`, `<div class="content-wrapper"><h1>${ROLE}</h1><p class="posting-categories">${COMPANY} · Boston, MA</p>
<form id="application-form" action="/submit/lever" method="post" enctype="multipart/form-data">
  <div class="application-question"><label>Full name</label><input name="name" type="text" required></div>
  <div class="application-question"><label>Email</label><input name="email" type="email" required></div>
  <div class="application-question"><label>Phone</label><input name="phone" type="tel"></div>
  <div class="application-question"><label>Current company</label><input name="org" type="text"></div>
  <div class="application-question"><label>LinkedIn URL</label><input name="urls[LinkedIn]" type="url"></div>
  <div class="application-question"><label>Portfolio URL</label><input name="urls[Portfolio]" type="url"></div>
  <div class="application-question"><label>Resume</label><input name="resume" type="file" accept=".pdf,.doc,.docx" required></div>
  <div class="application-question"><label>Cover letter</label><input name="coverLetter" type="file" accept=".pdf,.doc,.docx"></div>
  <div class="application-question"><label>Describe a relevant project.</label><textarea name="comments"></textarea></div>
  <div class="application-question"><label>Social Security Number</label><input name="ssn" type="text" inputmode="numeric"></div>
  <div class="application-question"><label>Date of Birth</label><input name="dob" type="date"></div>
  <div class="application-question"><fieldset><legend>Race</legend><label><input type="radio" name="race" value="asian"> Asian</label><label><input type="radio" name="race" value="white"> White</label><label><input type="radio" name="race" value="decline"> Prefer not to say</label></fieldset></div>
  <div class="application-question"><label>Disability Status</label><select name="disability"><option value="">Select…</option><option value="yes">Yes, I have a disability</option><option value="no">No</option></select></div>
  <div class="application-question"><label>Salary History</label><textarea name="salary"></textarea></div>
  <button type="submit" class="postings-btn">Submit application</button>
</form></div>`, submitScript('application-form'));

const ashbyApply = () => page(`Apply: ${ROLE} — ${COMPANY}`, `<div id="ashby_embed"><h1>${ROLE}</h1><p class="meta">${COMPANY} · Boston, MA</p>
<form id="application_form" action="/submit/ashby" method="post" enctype="multipart/form-data">
  <div class="_fieldEntry_1"><label for="_systemfield_name">Name</label><input id="_systemfield_name" name="_systemfield_name" type="text" required></div>
  <div class="_fieldEntry_2"><label for="_systemfield_email">Email</label><input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
  <div class="_fieldEntry_3"><label for="_systemfield_phone">Phone</label><input id="_systemfield_phone" name="_systemfield_phone" type="tel"></div>
  <div class="_fieldEntry_4"><label for="_systemfield_linkedin">LinkedIn Profile</label><input id="_systemfield_linkedin" name="_systemfield_linkedin" type="url"></div>
  <div class="_fieldEntry_5"><label for="_systemfield_resume">Resume</label><input id="_systemfield_resume" name="_systemfield_resume" type="file" accept="application/pdf" required></div>
  <div class="_fieldEntry_6"><label for="_systemfield_cover">Cover Letter</label><input id="_systemfield_cover" name="_systemfield_cover" type="file" accept="application/pdf"></div>
  <div class="_fieldEntry_7"><label for="_systemfield_project">Describe a relevant project.</label><textarea id="_systemfield_project" name="_systemfield_project"></textarea></div>
  <button type="submit">Submit Application</button>
</form></div>`, submitScript('application_form'));

const workdayBoard = () => page(`${ROLE} — ${COMPANY}`, `<h1 data-automation-id="jobPostingHeader">${ROLE}</h1><p class="meta">${COMPANY} · Boston, MA · R-123</p><p>Design and physically test chassis components for a production vehicle program.</p><a data-automation-id="adventureButton" href="${FIXTURE_PATHS.workday.apply}">Apply</a>`);

const workdayApply = () => page(`Apply: ${ROLE} — ${COMPANY}`, `<h1>My Information</h1><p class="meta">${COMPANY} · ${ROLE}</p>
<form id="application_form" data-automation-id="applyFlowMyInfoPage" action="/submit/workday" method="post" enctype="multipart/form-data">
  <div class="field"><label for="firstName">First Name</label><input id="firstName" name="firstName" data-automation-id="legalNameSection_firstName" type="text" required></div>
  <div class="field"><label for="lastName">Last Name</label><input id="lastName" name="lastName" data-automation-id="legalNameSection_lastName" type="text" required></div>
  <div class="field"><label for="email">Email Address</label><input id="email" name="email" data-automation-id="email" type="email" required></div>
  <div class="field"><label for="phone">Phone Number</label><input id="phone" name="phone" data-automation-id="phoneNumber" type="tel"></div>
  <div class="field"><label for="resume">Resume/CV</label><input id="resume" name="resume" data-automation-id="file-upload-input-ref" type="file" accept=".pdf,.doc,.docx" required></div>
  <div class="field"><label for="source">How Did You Hear About Us?</label><select id="source" name="source"><option value="">Select One</option><option value="linkedin">LinkedIn</option><option value="referral">Referral</option></select></div>
  <button type="button" data-automation-id="bottom-navigation-next-button" onclick="window.location.href='${FIXTURE_PATHS.workday.login}'">Save and Continue</button>
</form>`);

const workdayLogin = () => page(`Sign in — ${COMPANY}`, `<h1>Create Account or Sign In</h1><p>Welcome! Create an account to manage your application.</p><p>Your first-step answers were saved. Sign in to continue to the rest of the application.</p><button type="button" data-automation-id="createAccountLink">Create Account</button>`);

const linkedinBoard = () => page(`${ROLE} - ${COMPANY} | LinkedIn`, `<div class="top-card-layout"><p class="topcard__org-name-link">${COMPANY}</p><h1 class="top-card-layout__title">${ROLE}</h1><p class="topcard__flavor topcard__flavor--bullet">Boston, MA</p><div class="description__text"><p>Design and test chassis components.</p></div><button class="jobs-apply-button" type="button">Easy Apply</button></div>`);

const indeedBoard = () => page(`${ROLE} - ${COMPANY} - Indeed.com`, `<div id="viewJobSSRRoot"><h1 class="jobsearch-JobInfoHeader-title">${ROLE}</h1><div data-company-name="true">${COMPANY}</div><div id="jobDescriptionText"><p>Design and test chassis components.</p></div><button id="indeedApplyButton" type="button">Apply with Indeed</button></div>`);

const unknownBoard = () => page(`${ROLE} — careers`, `<main><h1>${ROLE}</h1><p class="meta">${COMPANY} · Boston, MA</p><p>We are a small hardware team. This job lives on our own careers site.</p><a href="/jobs/graduate-engineer/apply">Apply now</a></main>`);

const received = (host, kind) => page('Application received', `<h1>Application received</h1><p>Local fixture <strong>${escape(host)}</strong> recorded one submission for <strong>${escape(kind)}</strong>.</p><p>Nothing was sent to a real employer.</p>`);

function route(host, pathname) {
  const gh = FIXTURE_PATHS.greenhouse, ghp = FIXTURE_PATHS.greenhousePlanted, lv = FIXTURE_PATHS.lever, ab = FIXTURE_PATHS.ashby, wd = FIXTURE_PATHS.workday, li = FIXTURE_PATHS.linkedin, un = FIXTURE_PATHS.unknown;
  if (host === FIXTURE_HOSTS.greenhouse) {
    if (pathname === gh.board) return greenhouseBoard();
    if (pathname === gh.apply) return greenhouseApply();
    if (pathname === ghp.board) return page(`${ROLE} at ${COMPANY}`, `<h1>${ROLE}</h1><p class="meta">${COMPANY} · Boston, MA</p><a href="${ghp.board}/apply">Apply for this job</a>`);
    if (pathname === ghp.apply) return greenhouseApply({ planted: true });
  }
  if (host === FIXTURE_HOSTS.lever) {
    if (pathname === lv.board) return leverBoard();
    if (pathname === lv.apply) return leverApply();
  }
  if (host === FIXTURE_HOSTS.ashby && pathname === ab.apply) return ashbyApply();
  if (host === FIXTURE_HOSTS.workday) {
    if (pathname === wd.board) return workdayBoard();
    if (pathname === wd.apply) return workdayApply();
    if (pathname === wd.login) return workdayLogin();
  }
  if (host === FIXTURE_HOSTS.linkedin && pathname === li.board) return linkedinBoard();
  if (host === FIXTURE_HOSTS.indeed && pathname === '/viewjob') return indeedBoard();
  if (host === FIXTURE_HOSTS.unknown && pathname === un.board) return unknownBoard();
  return null;
}

async function keyPair() {
  const directory = await mkdtemp(path.join(tmpdir(), 'plainhand-u08-tls-'));
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem');
  const sans = Object.values(FIXTURE_HOSTS).map(host => `DNS:${host}`).join(',');
  try {
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=plainhand-u08-fixture', '-addext', `subjectAltName=${sans}`], { timeout: 30000 });
    return { directory, key: await readFile(key), cert: await readFile(cert) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(`The U08 fixture portals need openssl to make a local test certificate: ${error.message}`);
  }
}

// One HTTPS listener on loopback serves every fixture hostname; Chromium maps the
// real names to it. All writes are recorded so a submission is observable.
export async function startSiteFixtures() {
  const keys = await keyPair();
  const log = [];
  const server = https.createServer({ key: keys.key, cert: keys.cert }, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const url = new URL(req.url, `https://${host}`);
    const record = { host, method: req.method, path: url.pathname, search: url.search, at: new Date().toISOString() };
    if (req.method === 'POST') {
      let bytes = 0;
      req.on('data', chunk => { bytes += chunk.length; });
      req.on('end', () => { log.push({ ...record, bytes }); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(received(host, url.pathname)); });
      return;
    }
    log.push(record);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const html = req.method === 'GET' ? route(host, url.pathname) : null;
    if (!html) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(page('Not found', `<h1>Not found</h1><p>${escape(host)}${escape(url.pathname)}</p>`)); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const rules = Object.values(FIXTURE_HOSTS).map(host => `MAP ${host} 127.0.0.1:${port}`).join(', ');
  return {
    port,
    rules,
    hosts: FIXTURE_HOSTS,
    paths: FIXTURE_PATHS,
    log,
    postsFor: host => log.filter(entry => entry.host === host && entry.method === 'POST'),
    requestsFor: host => log.filter(entry => entry.host === host),
    async close() {
      await new Promise(resolve => server.close(resolve));
      await rm(keys.directory, { recursive: true, force: true });
    },
  };
}

// A real Chromium whose name resolution points at the loopback fixtures. The
// product's ApplicationBrowser is used unchanged; only the transport is local.
export function fixtureBrowserLaunch(sites) {
  return async () => {
    const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=${sites.rules}`] });
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async (options = {}) => createContext({ ignoreHTTPSErrors: true, ...options });
    return browser;
  };
}
