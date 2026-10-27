import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { applicationKey, buildApplicationTimeline } from './application-timeline.mjs';
import { buildWorkflowProjection } from './dashboard-workflow.mjs';
const reportHeaderPatterns = {
  archetype: [
    /^\*\*Arquetipo(?:\s+detectado)?\*\*\s*\|\s*(.+)$/im,
    /^\*\*Arquetipo:\*\*\s*(.+)$/im,
    /^\*\*Archetype:\*\*\s*(.+)$/im,
  ],
  tldr: [
    /^\*\*TL;DR\*\*\s*\|\s*(.+)$/im,
    /^\*\*TL;DR:\*\*\s*(.+)$/im,
  ],
  remote: [/^\*\*Remote\*\*\s*\|\s*(.+)$/im],
  comp: [/^\*\*Comp\*\*\s*\|\s*(.+)$/im],
  url: [/^\*\*URL:\*\*\s*(https?:\/\/\S+)/im],
  verdict: [/^## Verdict\s+([\s\S]*?)(?:\n## |\n# |$)/im],
};

const tokenStopwords = new Set([
  'a', 'an', 'and', 'assistant', 'associate', 'bus', 'chief', 'construction',
  'design', 'designer', 'engineer', 'engineering', 'for', 'general', 'improvement',
  'inspector', 'jr', 'junior', 'l1', 'l2', 'level', 'manh', 'of', 'ops', 'public',
  'regional', 'role', 'senior', 'steam', 'the', 'to', 'utility', 'worker',
]);
export async function buildDashboardPayload(options) {
  const {
    rootPath,
    host = null,
    port = null,
    linkMode = 'local',
    artifactMap = {},
    asOf = null,
  } = options;

  const canonicalTimeline = await loadCanonicalTimeline(rootPath);
  const timelineByKey = new Map(canonicalTimeline.applications.map((timeline) => [timeline.key, timeline]));
  const [states, apps, outputFiles] = await Promise.all([
    loadStates(rootPath),
    loadApplications(rootPath),
    indexOutputFiles(rootPath),
  ]);
  const pendingPipeline = await loadPendingPipeline(rootPath);

  const stateOrder = states.map((state) => state.id);
  const stateCounts = Object.fromEntries(stateOrder.map((id) => [id, 0]));
  if (!Object.hasOwn(stateCounts, 'apply')) {
    stateCounts.apply = 0;
  }

  const enrichedApps = [];
  for (const app of apps) {
    const summary = app.reportPath ? await loadReportSummary(rootPath, app.reportPath) : emptySummary();
    const matchedOutputFiles = matchOutputFiles(app, outputFiles);
    const timeline = timelineByKey.get(applicationKey(app.company, app.role));
    stateCounts[app.statusId] = (stateCounts[app.statusId] || 0) + 1;
    enrichedApps.push({
      ...app,
      reportUrl: app.reportPath ? resolveLinkedPath(app.reportPath, artifactMap, linkMode) : null,
      reportSummary: summary,
      outputFiles: matchedOutputFiles.map((file) => ({
        name: file.name,
        url: resolveLinkedPath(path.join('output', file.name), artifactMap, linkMode),
      })),
      timeline: timeline ? projectTimeline(timeline, artifactMap, linkMode) : null,
    });
  }

  const counts = {
    all: enrichedApps.length,
    withPdf: enrichedApps.filter((app) => app.hasPdf).length,
    actionable: enrichedApps.filter((app) => app.statusId === 'apply').length,
    byState: stateCounts,
  };

  return {
    generatedAt: new Date().toISOString(),
    host,
    port,
    linkMode,
    counts,
    states: states.map((state) => ({
      id: state.id,
      label: state.label,
      description: state.description,
      count: stateCounts[state.id] || 0,
    })),
    timelineSources: projectTimelineSources(canonicalTimeline.sources),
    workflow: buildWorkflowProjection(canonicalTimeline, { asOf }),
    pending: {
      count: pendingPipeline.length,
      items: pendingPipeline,
    },
    apps: enrichedApps,
  };
}

function projectTimeline(timeline, artifactMap, linkMode) {
  return {
    ...timeline,
    artifacts: timeline.artifacts.map((artifact) => ({
      ...artifact,
      url: artifact.path ? resolveLinkedPath(artifact.path, artifactMap, linkMode) : null,
    })),
  };
}

function projectTimelineSources(sources) {
  return Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [name, {
      status: source.status,
      rows: source.rows,
    }]),
  );
}

async function loadCanonicalTimeline(rootPath) {
  try {
    return buildApplicationTimeline(rootPath);
  } catch (error) {
    if (error?.code !== 'APPLICATION_TIMELINE_TRACKER_MISSING') throw error;
    const absentSource = (name) => ({ name, path: null, status: 'absent', rows: 0 });
    return {
      contractVersion: 1,
      applications: [],
      sources: {
        tracker: absentSource('tracker'),
        contacts: absentSource('contacts'),
        followUps: absentSource('followUps'),
        drafts: absentSource('drafts'),
        interviews: absentSource('interviews'),
      },
    };
  }
}

export async function loadArtifactMap(mapPath) {
  if (!mapPath) return {};
  const raw = await fs.readFile(mapPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Artifact map must be an object: ${mapPath}`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => [normalizeRelativePath(key), value.trim()]),
  );
}

function resolveLinkedPath(relativePath, artifactMap, linkMode) {
  const normalized = normalizeRelativePath(relativePath);
  if (artifactMap[normalized]) {
    return artifactMap[normalized];
  }
  if (linkMode === 'hybrid') {
    return null;
  }
  return toFileRoute(normalized);
}

async function loadStates(rootPath) {
  const statesPath = path.join(rootPath, 'templates', 'states.yml');
  const raw = await fs.readFile(statesPath, 'utf8');
  const parsed = yaml.load(raw);
  return Array.isArray(parsed?.states) ? parsed.states : [];
}

async function loadApplications(rootPath) {
  const states = await loadStates(rootPath);
  const stateByAlias = buildStateAliasMap(states);
  const filePath = await resolveApplicationsPath(rootPath);
  if (!filePath) return [];
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const apps = [];
  let rowIndex = 0;

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line || !line.startsWith('|') || line.startsWith('|---') || line.startsWith('| #')) {
      continue;
    }
    const fields = splitApplicationRow(line);
    if (fields.length < 8) continue;

    rowIndex += 1;
    const reportMatch = fields[7].match(/\[(\d+)\]\(([^)]+)\)/);
    const canonical = canonicalizeStatus(fields[5], stateByAlias);
    apps.push({
      id: Number.parseInt(fields[0], 10) || rowIndex,
      date: fields[1],
      company: fields[2],
      role: fields[3],
      score: parseScore(fields[4]),
      scoreRaw: fields[4],
      status: canonical.label,
      statusId: canonical.id,
      statusRaw: fields[5],
      hasPdf: fields[6].includes('✅'),
      reportNumber: reportMatch?.[1] || null,
      reportPath: reportMatch?.[2] || null,
      notes: fields[8] || '',
    });
  }

  return apps;
}

function buildStateAliasMap(states) {
  const map = new Map();
  for (const state of states) {
    const aliases = [state.id, state.label, ...(state.aliases || [])];
    for (const alias of aliases) {
      map.set(normalizeStatusKey(alias), state);
    }
  }
  return map;
}

function canonicalizeStatus(status, stateByAlias) {
  const normalized = normalizeStatusKey(status);
  const matched = stateByAlias.get(normalized);
  if (matched) {
    return { id: matched.id, label: matched.label };
  }
  return { id: normalized || 'unknown', label: status.trim() || 'Unknown' };
}

function normalizeStatusKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveApplicationsPath(rootPath) {
  const primary = path.join(rootPath, 'data', 'applications.md');
  const fallback = path.join(rootPath, 'applications.md');
  if (await pathExists(primary)) return primary;
  if (await pathExists(fallback)) return fallback;
  return null;
}

function splitApplicationRow(line) {
  if (line.includes('\t')) {
    return line
      .replace(/^\|/, '')
      .trim()
      .split('\t')
      .map((part) => part.trim().replace(/^\|+|\|+$/g, ''));
  }
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => part.trim());
}

function parseScore(scoreRaw) {
  const match = String(scoreRaw || '').match(/(\d+\.?\d*)\/5/);
  return match ? Number.parseFloat(match[1]) : 0;
}

async function loadReportSummary(rootPath, reportPath) {
  const fullPath = safeResolve(rootPath, reportPath);
  let raw = '';
  try {
    raw = await fs.readFile(fullPath, 'utf8');
  } catch {
    // One missing report must not kill the whole dashboard build.
    return emptySummary();
  }
  const header = raw.slice(0, 2500);
  return {
    archetype: extractFirst(header, reportHeaderPatterns.archetype),
    tldr: extractFirst(header, reportHeaderPatterns.tldr),
    remote: extractFirst(header, reportHeaderPatterns.remote),
    comp: extractFirst(header, reportHeaderPatterns.comp),
    url: extractFirst(header, reportHeaderPatterns.url),
    verdict: extractFirst(header, reportHeaderPatterns.verdict).replace(/\s+/g, ' ').trim(),
  };
}

function emptySummary() {
  return { archetype: '', tldr: '', remote: '', comp: '', url: '', verdict: '' };
}

function extractFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return '';
}

async function indexOutputFiles(rootPath) {
  let files = [];
  try {
    files = await fs.readdir(path.join(rootPath, 'output'), { withFileTypes: true });
  } catch {
    // No output/ directory — dashboard still builds, just without artifact links.
    return [];
  }
  return files
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      normalized: normalizeFileKey(entry.name),
      ext: path.extname(entry.name).toLowerCase(),
    }));
}

async function loadPendingPipeline(rootPath) {
  const pipelinePath = path.join(rootPath, 'data', 'pipeline.md');
  if (!await pathExists(pipelinePath)) {
    return [];
  }

  const raw = await fs.readFile(pipelinePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const items = [];
  let currentSection = 'Pending';
  let inPendingBlock = false;

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) continue;

    const headingMatch = line.match(/^(##+)\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const label = headingMatch[2].trim();

      if (level === 2) {
        const normalized = normalizePipelineSectionLabel(label);
        inPendingBlock = normalized === 'Pending';
        currentSection = normalized;
      } else if (inPendingBlock) {
        currentSection = label;
      }
      continue;
    }

    if (!inPendingBlock) continue;

    const pendingMatch = line.match(/^- \[\s\] (.+)$/);
    if (!pendingMatch) continue;

    const body = pendingMatch[1].trim();
    const parts = body.split('|').map((part) => part.trim());
    const url = parts[0]?.match(/https?:\/\/\S+/)?.[0] || '';
    const company = parts[1] || '';
    const role = parts[2] || '';
    const location = parts[3] || '';
    const comp = parts[4] || '';
    const note = parts.slice(5).join(' | ');

    items.push({
      id: `pending-${items.length + 1}`,
      section: currentSection,
      url,
      company,
      role,
      location,
      comp,
      note,
      sourceLine: body,
    });
  }

  return items;
}

function normalizePipelineSectionLabel(label) {
  const normalized = label.trim().toLowerCase();
  const aliases = new Map([
    ['pendientes', 'Pending'],
    ['pending', 'Pending'],
    ['procesadas', 'Processed'],
    ['processed', 'Processed'],
  ]);
  return aliases.get(normalized) || label;
}

function matchOutputFiles(app, outputFiles) {
  const companyTokens = tokenize(`${app.company}`);
  const roleTokens = tokenize(`${app.role}`);
  const reportTokens = tokenize(path.basename(app.reportPath || '', path.extname(app.reportPath || '')));
  const dateBits = app.date.split('-').filter(Boolean);

  const matches = [];
  for (const file of outputFiles) {
    let score = 0;
    const matched = new Set();

    for (const token of companyTokens) {
      if (file.normalized.includes(token)) {
        matched.add(token);
        score += 3;
      }
    }
    for (const token of roleTokens) {
      if (file.normalized.includes(token)) {
        matched.add(token);
        score += 1;
      }
    }
    for (const token of reportTokens) {
      if (file.normalized.includes(token)) {
        matched.add(token);
        score += 1;
      }
    }
    if (app.reportNumber && file.normalized.includes(app.reportNumber.toLowerCase())) {
      score += 4;
    }
    if (dateBits.every((bit) => file.normalized.includes(bit))) {
      score += 2;
    }
    if (file.ext === '.pdf') score += 1;

    const hasCompanySignal = companyTokens.some((token) => file.normalized.includes(token));
    const enoughSignal = matched.size >= 2 || (hasCompanySignal && score >= 4);
    if (!enoughSignal) continue;

    matches.push({ ...file, score });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function tokenize(value) {
  return normalizeFileKey(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !tokenStopwords.has(token));
}

function normalizeFileKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
}

function safeResolve(root, requested) {
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${requested}`);
  }
  return resolved;
}

function toFileRoute(relativePath) {
  return `/file/${normalizeRelativePath(relativePath)}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
