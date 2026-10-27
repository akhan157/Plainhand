#!/usr/bin/env node

/**
 * check-liveness.mjs — Playwright job link liveness checker
 *
 * Tests whether job posting URLs are still active or have expired.
 * Uses the same detection logic as scan.md step 7.5.
 * Zero Claude API tokens — pure Playwright.
 *
 * Usage:
 *   node check-liveness.mjs <url1> [url2] ...
 *   node check-liveness.mjs --file urls.txt
 *
 * Exit code: 0 if all active, 1 if any expired or uncertain
 */

import { readFile } from 'fs/promises';
import { classifyLiveness } from './liveness-core.mjs';
import {
  checkUrlLivenessWithFallback,
  createHeadedPageProvider,
  newLivenessPage,
  jitteredDelayMs,
  sleep,
  rejectPrivateOrInvalid,
  LIVENESS_CONTEXT_OPTIONS,
} from './liveness-browser.mjs';

// Browserless check for --no-playwright mode (CI, machines without Chromium).
// Plain fetch + HTML stripping feeds the same classifyLiveness used by the
// Playwright path. Limitation: client-rendered SPAs (Workday, some Ashby) ship
// thin HTML, which the classifier would read as expired — downgrade that one
// verdict to uncertain so a live posting is never dropped without a browser look.
async function httpCheckUrlLiveness(url) {
  const guardError = rejectPrivateOrInvalid(url);
  if (guardError) {
    return { result: 'uncertain', code: guardError.code, reason: guardError.reason };
  }
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': LIVENESS_CONTEXT_OPTIONS.userAgent,
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
        reason: 'thin HTML without JS rendering — needs a browser check',
      };
    }
    return verdict;
  } catch (err) {
    return {
      result: 'uncertain',
      code: 'fetch_error',
      reason: `fetch error: ${err.message.split('\n')[0]}`,
    };
  }
}

const KNOWN_FLAGS = ['--no-fallback', '--no-playwright', '--file'];

async function main() {
  const args = process.argv.slice(2);

  // Portals like pracuj.pl serve a Cloudflare anti-bot wall to headless Chromium.
  // On a challenge we retry once in a headed browser (which clears it); pass
  // --no-fallback to stay fully headless (e.g. on a machine with no display).
  const noFallback = args.includes('--no-fallback');
  // --no-playwright: never launch Chromium; check via plain HTTP fetch instead.
  // For environments without a Playwright browser (CI, fresh machines).
  const noPlaywright = args.includes('--no-playwright');
  // --throttle or --throttle=<ms>: wait base..2*base ms (jittered) between checks
  // to stay under rate-based WAF limits. pracuj.pl's Cloudflare flags the session
  // after ~2 rapid hits, so a bulk run needs spacing. Default base 5000ms.
  const throttleArg = args.find((a) => a === '--throttle' || a.startsWith('--throttle='));
  const throttleBaseMs = throttleArg ? (Number(throttleArg.split('=')[1]) || 5000) : 0;
  const positional = args.filter(
    (a) => a !== '--no-fallback' && a !== '--no-playwright' && a !== throttleArg,
  );

  // Unknown flags must fail loudly — silently treating a flag as a URL corrupts
  // the result counts (each bad "URL" lands in the uncertain bucket).
  const unknownFlags = positional.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.includes(a));
  if (unknownFlags.length > 0) {
    console.error(`Unknown flag(s): ${unknownFlags.join(' ')}`);
    console.error('Known flags: --no-fallback, --no-playwright, --throttle[=ms], --file <path>');
    process.exit(1);
  }

  if (positional.length === 0) {
    console.error('Usage: node check-liveness.mjs [--no-fallback] [--no-playwright] [--throttle[=ms]] <url1> [url2] ...');
    console.error('       node check-liveness.mjs [--no-fallback] [--no-playwright] [--throttle[=ms]] --file urls.txt');
    process.exit(1);
  }

  let urls;
  if (positional[0] === '--file') {
    const text = await readFile(positional[1], 'utf-8');
    urls = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } else {
    urls = positional;
  }

  const notes = [
    noPlaywright ? 'http-only, no browser' : (noFallback ? null : 'headed fallback on challenge'),
    throttleBaseMs ? `throttle ~${throttleBaseMs / 1000}-${(throttleBaseMs * 2) / 1000}s` : null,
  ].filter(Boolean);
  console.log(`Checking ${urls.length} URL(s)...${notes.length ? ` (${notes.join(', ')})` : ''}\n`);

  let browser = null;
  let page = null;
  let headed = null;
  let getHeadedPage;
  if (!noPlaywright) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    page = await newLivenessPage(browser);
    headed = noFallback ? null : createHeadedPageProvider(chromium);
    getHeadedPage = headed ? () => headed.get() : undefined;
  }

  let active = 0, expired = 0, uncertain = 0;

  // Sequential — project rule: never Playwright in parallel
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const { result, reason } = noPlaywright
      ? await httpCheckUrlLiveness(url)
      : await checkUrlLivenessWithFallback(page, url, { getHeadedPage });
    const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result];
    console.log(`${icon} ${result.padEnd(10)} ${url}`);
    if (result !== 'active') console.log(`           ${reason}`);
    if (result === 'active') active++;
    else if (result === 'expired') expired++;
    else uncertain++;

    const wait = i < urls.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
    if (wait) await sleep(wait);
  }

  if (headed) await headed.close();
  if (browser) await browser.close();

  console.log(`\nResults: ${active} active  ${expired} expired  ${uncertain} uncertain`);
  // process.exitCode (not process.exit) — a hard exit while undici keep-alive
  // sockets are mid-teardown trips a libuv assertion on Windows
  // (src\win\async.c:76) and corrupts the exit code to 127.
  if (expired > 0 || uncertain > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
