#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { main as buildResumeMain } from './build-resume.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    buildResumeMain(process.argv.slice(2));
  } catch (error) {
    console.error(`Resume build failed: ${error.message}`);
    process.exit(1);
  }
}
