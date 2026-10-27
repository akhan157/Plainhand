#!/usr/bin/env node

import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profilePath = resolve(__dirname, 'config', 'profile.yml');
const answersPath = resolve(__dirname, 'data', 'application-answers.md');
const outputDir = resolve(__dirname, 'output');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case '--report': args.report = next; index += 1; break;
      case '--company': args.company = next; index += 1; break;
      case '--role': args.role = next; index += 1; break;
      case '--practice-area': args.practiceArea = next; index += 1; break;
      case '--date': args.date = next; index += 1; break;
      case '--job-source': args.jobSource = next; index += 1; break;
      case '--job-source-type': args.jobSourceType = next; index += 1; break;
      case '--format': args.format = next; index += 1; break;
      default: break;
    }
  }
  return args;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    || 'unknown';
}

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function currentTimestamp() {
  return new Date().toISOString();
}

function getGeneratorVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function splitIdentityHeading(heading) {
  const pipeParts = heading.split('|').map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    return {
      company: pipeParts[0].replace(/^\d+\s+[—-]\s+/, '').trim(),
      role: pipeParts.slice(1).join(' | '),
    };
  }

  const slashParts = heading.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    return {
      company: slashParts.slice(0, -1).join(' / '),
      role: slashParts.at(-1),
    };
  }

  const dashParts = heading.split(/\s+[—-]\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    return {
      company: dashParts[0],
      role: dashParts.slice(1).join(' - '),
    };
  }

  return { company: heading.trim(), role: null };
}

function parseReport(reportPath) {
  const absolutePath = resolve(reportPath);
  const text = readFileSync(absolutePath, 'utf8');
  const headingMatch = text.match(/^#(?:\s+Evaluation:)?\s+(.+)$/m);
  const dateMatch = text.match(/^\*\*Date:\*\*\s+([0-9]{4}-[0-9]{2}-[0-9]{2})$/m);
  const urlMatch = text.match(/^\*\*URL:\*\*\s+(.+)$/m);
  const heading = headingMatch ? headingMatch[1].trim() : basename(absolutePath, extname(absolutePath));
  const identity = splitIdentityHeading(heading);

  return {
    absolutePath,
    relativePath: relative(__dirname, absolutePath).replace(/\\/g, '/'),
    reportId: basename(absolutePath, extname(absolutePath)),
    text,
    heading,
    company: identity.company,
    role: identity.role,
    date: dateMatch ? dateMatch[1] : null,
    url: urlMatch ? urlMatch[1].trim() : null,
  };
}

function extractQ15Template(markdown) {
  const match = markdown.match(/## Q15[\s\S]*?\n\n([\s\S]*?)\n---\s*$/);
  if (!match) {
    throw new Error('Could not find Q15 cover letter template in data/application-answers.md');
  }
  return match[1].trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSection(reportText, title) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^##\\s+${escapedTitle}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, 'm');
  const match = reportText.match(pattern);
  return match ? match[1].trim() : '';
}

function detectFormat(reportText, fallback = 'letter') {
  if (/\b(New Zealand|Auckland|United Kingdom|London|Germany|France|Spain|Italy|Netherlands|India|Singapore|Australia)\b/i.test(reportText)) {
    return 'a4';
  }
  if (/\b(United States|USA|U\.S\.|California|Texas|Michigan|Canada)\b/i.test(reportText)) {
    return 'letter';
  }
  return fallback;
}

function classifyFocus(reportText, roleText) {
  const haystack = `${reportText}\n${roleText}`;
  if (/\b(propulsion|rocket|aerospace|flight|spacecraft|test stand|launch)\b/i.test(haystack)) {
    return 'aerospace';
  }
  if (/\b(manufacturing|production|plant|quality|validation|fixture|shop|operations)\b/i.test(haystack)) {
    return 'manufacturing';
  }
  if (/\b(civil|infrastructure|water|wastewater|sewer|drainage|inspection|municipal|field)\b/i.test(haystack)) {
    return 'infrastructure';
  }
  if (/\b(cad|drawings|designer|design engineer|autocad|revit|detail)\b/i.test(haystack)) {
    return 'design';
  }
  return 'general';
}

function derivePracticeArea(args, report) {
  if (args.practiceArea) {
    return args.practiceArea;
  }

  const roleSummary = getSection(report.text, 'Role Summary');
  const levelAssessment = getSection(report.text, 'Level Assessment');
  const seed = `${roleSummary} ${levelAssessment}`;
  const match = seed.match(/\b(infrastructure|water|wastewater|civil|building systems|manufacturing|quality|propulsion|aerospace hardware|mechanical design|field engineering|inspection)\b/i);
  if (match) {
    return match[1].toLowerCase();
  }

  return 'engineering work';
}

// The candidate's own story lines live in config/cover-letter.yml (gitignored, like
// config/profile.yml); config/cover-letter.example.yml shows the shape. Nothing personal
// is kept in this file.
function loadLetterContent() {
  const file = resolve(__dirname, 'config', 'cover-letter.yml');
  if (!existsSync(file)) throw new Error('Create config/cover-letter.yml from config/cover-letter.example.yml with your own paragraphs, or draft cover letters from your evidence in the Plainhand app (npm start).');
  const content = yaml.load(readFileSync(file, 'utf-8')) || {};
  if (!content.intro || !content.paragraphs?.general) throw new Error('config/cover-letter.yml needs intro and paragraphs.general.');
  return content;
}

const DEFAULT_HOOKS = {
  aerospace: '{company} is doing the kind of propulsion and hardware development work I want to build my early career around.',
  manufacturing: "{company}'s manufacturing and hands-on engineering environment matches the kind of floor-adjacent mechanical work I want to grow into.",
  infrastructure: "{company}'s infrastructure-focused engineering work lines up with the field-driven systems work I want to keep doing.",
  design: "{company}'s design-focused engineering work fits the kind of drafting, coordination, and buildable mechanical work I want to keep developing.",
  general: '{company} is doing the kind of {practiceArea} work I want to grow into.',
};
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (all, key) => values[key] ?? all);

function buildCompanyHook(company, focus, practiceArea, content) {
  return fill(content.hooks?.[focus] || DEFAULT_HOOKS[focus] || content.hooks?.general || DEFAULT_HOOKS.general, { company, practiceArea });
}

function buildSupportParagraphs(focus, content) {
  const paragraphs = content.paragraphs[focus] || content.paragraphs.general;
  return [paragraphs[0] || '', paragraphs[1] || ''];
}

function buildRoleAwareBody(args, report, template, profile) {
  const focus = classifyFocus(report.text, args.role || report.role || '');
  const practiceArea = derivePracticeArea(args, report);
  const content = loadLetterContent();
  const supportParagraphs = buildSupportParagraphs(focus, content);
  const companyHook = buildCompanyHook(args.company, focus, practiceArea, content);
  const candidateName = profile?.candidate?.full_name || 'Candidate';
  const signatureEmail = profile?.candidate?.email || '';
  const signaturePhone = profile?.candidate?.phone || '';
  const signatureLinkedin = profile?.candidate?.linkedin || '';

  const intro = fill(content.intro, { role: args.role, company: args.company });
  const closing = `${companyHook} I'm looking for an entry-level role where I can contribute to ${practiceArea} work and continue developing inside a strong engineering team.`;

  const bodyParagraphs = [
    'Dear Hiring Team,',
    intro,
    supportParagraphs[0],
    supportParagraphs[1],
    closing,
    'Thank you for your time and consideration.',
    `${candidateName}\n${[signatureEmail, signaturePhone, signatureLinkedin].filter(Boolean).join(' | ')}`,
  ];

  const templateBaseline = template
    .replaceAll('[Role Title]', args.role)
    .replaceAll('[Company Name]', args.company)
    .replaceAll('[specific project type or practice area]', practiceArea)
    .trim();

  return {
    markdown: `${bodyParagraphs.join('\n\n')}\n`,
    templateBaseline,
    practiceArea,
  };
}

function renderHtmlDocument(profile, body, format) {
  const htmlParagraphs = body
    .trim()
    .split(/\r?\n\r?\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('\n');

  const title = profile?.candidate?.full_name || 'Cover Letter';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} Cover Letter</title>
<style>
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 12pt;
    line-height: 1.35;
    color: #000;
    margin: 0;
  }
  .page {
    max-width: 8.5in;
    margin: 0 auto;
    padding: 0;
  }
  p {
    margin: 0 0 0.8em 0;
  }
  @page {
    size: ${format};
    margin: 0.75in;
  }
</style>
</head>
<body>
  <div class="page">
    ${htmlParagraphs}
  </div>
</body>
</html>
`;
}

function toFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => `"${String(item).replace(/"/g, '\\"')}"`).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `"${String(value ?? '').replace(/"/g, '\\"')}"`;
}

function writeMetaFile(metaPath, fields, notes) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${toFrontmatterValue(value)}`);
  }
  lines.push('---', '', '# Cover Letter Artifact', '');
  lines.push(`Generated for ${fields.company} - ${fields.role}.`);
  if (notes.length > 0) {
    lines.push('', '## Tailoring Notes', '');
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
  }
  writeFileSync(metaPath, `${lines.join('\n')}\n`);
}

function resolveIdentity(args, report, profile) {
  const company = args.company || report.company;
  const role = args.role || report.role;
  if (!company || !role) {
    throw new Error('Could not resolve exact company and role identity. Pass --company and --role explicitly or use a report with both values.');
  }

  const fullName = profile?.candidate?.full_name;
  if (!fullName) {
    throw new Error('config/profile.yml is missing candidate.full_name, which is required for contract-managed artifact naming.');
  }

  return {
    candidate: slugify(fullName),
    company,
    companySlug: slugify(company),
    role,
    roleSlug: slugify(role),
    artifactDate: args.date || report.date || currentDate(),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report) {
    console.error('Usage: node generate-cover-letter.mjs --report <report.md> [--company <name>] [--role <title>] [--practice-area <text>] [--date <YYYY-MM-DD>] [--format <letter|a4>] [--job-source <path-or-url>] [--job-source-type <url|jd_file|manual>]');
    process.exit(1);
  }

  const profile = loadYaml(profilePath);
  const answers = readFileSync(answersPath, 'utf8');
  const template = extractQ15Template(answers);
  const report = parseReport(args.report);
  const identity = resolveIdentity(args, report, profile);
  const format = args.format || detectFormat(report.text, 'letter');
  const baseName = `cover-letter-${identity.candidate}-${identity.companySlug}-${identity.roleSlug}-${identity.artifactDate}`;
  const htmlPath = resolve(outputDir, `${baseName}.html`);
  const pdfPath = resolve(outputDir, `${baseName}.pdf`);
  const metaPath = resolve(outputDir, `${baseName}.meta.md`);

  const body = buildRoleAwareBody(
    { ...args, company: identity.company, role: identity.role },
    report,
    template,
    profile
  );
  const html = renderHtmlDocument(profile, body.markdown, format);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(htmlPath, html);

  const pdfResult = spawnSync(
    process.execPath,
    [resolve(__dirname, 'generate-pdf.mjs'), htmlPath, pdfPath, `--format=${format}`],
    { cwd: __dirname, stdio: 'inherit' }
  );
  if (pdfResult.status !== 0) {
    process.exit(pdfResult.status ?? 1);
  }

  const jobSource = args.jobSource || report.url || report.absolutePath;
  const jobSourceType = args.jobSourceType || (report.url ? 'url' : 'jd_file');
  const metaFields = {
    artifact_type: 'cover_letter',
    candidate: identity.candidate,
    company: identity.company,
    company_slug: identity.companySlug,
    role: identity.role,
    role_slug: identity.roleSlug,
    artifact_date: identity.artifactDate,
    generated_at: currentTimestamp(),
    source_baseline: 'data/application-answers.md#q15',
    job_source: jobSource,
    job_source_type: jobSourceType,
    report_path: report.relativePath,
    report_id: report.reportId,
    jd_fingerprint: sha256(`${jobSource}\n${report.text}`),
    content_fingerprint: sha256(body.markdown),
    generator: 'generate-cover-letter.mjs',
    generator_version: getGeneratorVersion(),
    status: 'ready',
    variants: ['html', 'pdf'],
  };
  const notes = [
    `practice_area: ${body.practiceArea}`,
    `report_heading: ${report.heading}`,
    `source_template: data/application-answers.md#q15`,
  ];
  writeMetaFile(metaPath, metaFields, notes);

  console.log(`Cover letter generated:
  HTML: ${htmlPath}
  PDF: ${pdfPath}
  Metadata: ${metaPath}`);
}

main();
