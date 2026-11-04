#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPLACEMENTS = [
  [/ /g, ' '],
  [/[​‌‍﻿]/g, ''],
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[–—]/g, '-'],
  [/…/g, '...'],
  [/•/g, '*'],
  [/[←↑→↓]/g, '->'],
];

function sanitize(text) {
  return REPLACEMENTS.reduce((s, [r, repl]) => s.replace(r, repl), text);
}

const PLACEHOLDER_PATTERNS = [
  /\[\[/,
  /\]\]/,
  /\bTODO\b/,
  /\bTBD\b/,
  /\bXXX\b/,
  /\bPLACEHOLDER\b/,
  /\bFIXME\b/,
  /\{\{[A-Z_]+\}\}/,
];

function scanPlaceholders(text, path) {
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({ line: i + 1, content: line.trim().slice(0, 100), pattern: pattern.source });
        break;
      }
    }
  });
  if (hits.length > 0) {
    console.warn(`\n  placeholder markers in ${path}:`);
    hits.forEach(h => console.warn(`    line ${h.line}: ${h.content}  [${h.pattern}]`));
  }
  return hits.length;
}

function scanDuplicateBullets(text, path) {
  const bullets = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*]\s/.test(l) && l.length > 30);
  const counts = new Map();
  for (const b of bullets) {
    const key = b.toLowerCase().replace(/\s+/g, ' ');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const dups = [...counts.entries()].filter(([, n]) => n > 1);
  if (dups.length > 0) {
    console.warn(`\n  duplicate bullets in ${path}:`);
    dups.forEach(([b, n]) => console.warn(`    x${n}: ${b.slice(0, 100)}`));
  }
  return dups.length;
}

const args = process.argv.slice(2);
let totalPlaceholderHits = 0;
let totalDupHits = 0;

function processFile(path, label) {
  const before = readFileSync(path, 'utf8');
  const after = sanitize(before);
  if (before !== after) {
    writeFileSync(path, after, 'utf8');
    console.log(`cleaned: ${label}`);
  }
  totalPlaceholderHits += scanPlaceholders(after, label);
  totalDupHits += scanDuplicateBullets(after, label);
  return before !== after;
}

if (args.length === 0) {
  const dir = 'output';
  const files = readdirSync(dir).filter(f => f.startsWith('answers-') && f.endsWith('.md'));
  let cleaned = 0;
  for (const f of files) {
    if (processFile(join(dir, f), f)) cleaned++;
  }
  console.log(`\ntotal: ${cleaned} of ${files.length} cleaned`);
} else {
  for (const path of args) processFile(path, path);
}

if (totalPlaceholderHits > 0 || totalDupHits > 0) {
  console.warn(`\n  warnings: ${totalPlaceholderHits} placeholder hit(s), ${totalDupHits} duplicate bullet group(s) — review before sending`);
}
