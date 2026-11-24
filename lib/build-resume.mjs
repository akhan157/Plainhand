#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import { buildBaselineResume, buildTailoredResume, parseCliArgs } from './resume-tailoring-lib.mjs';
import { missingResumeInputs } from './render-resume.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

export function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const missing = missingResumeInputs();
  if (missing.length) throw new Error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Create your structured resume in data/resume-source.yml and its layout rules in data/resume-rules.yml, then run this again.`);
  if (args.report) {
    const result = buildTailoredResume(args);
    console.log(`Tailored resume build complete:
  Report: ${result.report.absolutePath}
  PDF: ${result.artifacts.pdf}
  Metadata: ${result.artifacts.meta}`);
    return;
  }

  const rules = loadYaml(resolve(ROOT, 'data', 'resume-rules.yml'));
  const baseline = buildBaselineResume();
  const mdPath = baseline.mdPath;
  const htmlPath = baseline.htmlPath;
  const pdfPath = resolve(ROOT, rules.resume.generated_pdf);

  const format = rules.resume.format || 'letter';
  const pdfResult = spawnSync(
    process.execPath,
    [resolve(__dirname, 'generate-pdf.mjs'), htmlPath, pdfPath, `--format=${format}`],
    { cwd: ROOT, stdio: 'inherit' }
  );

  if (pdfResult.status !== 0) {
    process.exit(pdfResult.status ?? 1);
  }

  console.log(`Resume build complete:
  Markdown: ${mdPath}
  HTML: ${htmlPath}
  PDF: ${pdfPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Resume build failed: ${error.message}`);
    process.exit(1);
  }
}
