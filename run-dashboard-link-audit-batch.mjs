#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  checkUrlLivenessWithFallback,
  createHeadedPageProvider,
  jitteredDelayMs,
  newLivenessPage,
  sleep,
} from './liveness-browser.mjs';
import { classifyLiveness } from './liveness-core.mjs';

const ACTIONABLE_STATUSES = new Set(['apply', 'applied', 'interview', 'responded']);

const args = parseArgs(process.argv.slice(2));
if (!args.batch) {
  printHelp();
  process.exit(1);
}

const batchPath = path.resolve(args.batch);
const outPath = path.resolve(args.out || `${batchPath}.results.json`);
const mode = normalizeMode(args.mode);
const throttleBaseMs = clampNonNegativeInt(args.throttle, mode === 'http' ? 1000 : 5000);

const rows = JSON.parse(await fs.readFile(batchPath, 'utf8'));
if (!Array.isArray(rows)) {
  throw new Error(`Batch file must be a JSON array: ${batchPath}`);
}

let browser = null;
let page = null;
let headed = null;
let getHeadedPage;

if (mode === 'browser') {
  browser = await chromium.launch({ headless: true });
  page = await newLivenessPage(browser);
  headed = createHeadedPageProvider(chromium);
  getHeadedPage = () => headed.get();
}

const results = [];
for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  const verdict = mode === 'http'
    ? await httpCheckUrlLiveness(row.url)
    : await checkUrlLivenessWithFallback(page, row.url, { getHeadedPage });

  results.push({
    ...row,
    ...verdict,
    actionable: ACTIONABLE_STATUSES.has(row.statusId),
    checkedAt: new Date().toISOString(),
    mode,
  });

  const waitMs = index < rows.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
  if (waitMs) await sleep(waitMs);
}

await headed?.close();
await browser?.close();

const summary = {
  generatedAt: new Date().toISOString(),
  batchPath,
  outPath,
  mode,
  counts: countResults(results),
  results,
};

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`Wrote ${results.length} result(s) to ${outPath}`);
console.log(JSON.stringify(summary.counts));

async function httpCheckUrlLiveness(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const applyControls = [];
    const controlRe = /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>|<input\b[^>]*type=["'](?:submit|button)["'][^>]*>/gi;
    let match;
    while ((match = controlRe.exec(html)) && applyControls.length < 500) {
      const label = (match[1] || match[0])
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (label) applyControls.push(label);
    }
    const verdict = classifyLiveness({ status: res.status, finalUrl: res.url, bodyText, applyControls });
    if (verdict.result === 'expired' && verdict.code === 'insufficient_content') {
      return {
        result: 'uncertain',
        code: 'spa_unrendered',
        reason: 'thin HTML without JS rendering - needs browser check',
      };
    }
    return verdict;
  } catch (error) {
    return {
      result: 'uncertain',
      code: 'fetch_error',
      reason: `fetch error: ${String(error.message || error).split('\n')[0]}`,
    };
  }
}

function countResults(results) {
  const counts = { active: 0, expired: 0, uncertain: 0, actionableEscalations: 0 };
  for (const result of results) {
    counts[result.result] = (counts[result.result] || 0) + 1;
    if (result.result === 'uncertain' && result.actionable) {
      counts.actionableEscalations += 1;
    }
  }
  return counts;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function normalizeMode(rawValue) {
  return rawValue === 'browser' ? 'browser' : 'http';
}

function clampNonNegativeInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function printHelp() {
  console.log('Usage: node run-dashboard-link-audit-batch.mjs --batch <json> [--out <json>] [--mode http|browser] [--throttle <ms>]');
}
