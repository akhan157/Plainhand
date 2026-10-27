#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import { buildBaselineResume, buildTailoredResume, parseCliArgs } from './resume-tailoring-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

export function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.report) {
    const result = buildTailoredResume(args);
    console.log(`Tailored resume build complete:
  Report: ${result.report.absolutePath}
  PDF: ${result.artifacts.pdf}
  Metadata: ${result.artifacts.meta}`);
    return;
  }

  const rules = loadYaml(resolve(__dirname, 'data', 'resume-rules.yml'));
  const baseline = buildBaselineResume();
  const mdPath = baseline.mdPath;
  const htmlPath = baseline.htmlPath;
  const pdfPath = resolve(__dirname, rules.resume.generated_pdf);

  const format = rules.resume.format || 'letter';
  const pdfResult = spawnSync(
    process.execPath,
    [resolve(__dirname, 'generate-pdf.mjs'), htmlPath, pdfPath, `--format=${format}`],
    { cwd: __dirname, stdio: 'inherit' }
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
