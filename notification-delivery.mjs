#!/usr/bin/env node
/** Local-first notification delivery. No channel is contacted unless explicitly configured. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson } from './scan-state.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const iso = (value) => { const date = new Date(value ?? Date.now()); if (Number.isNaN(date.valueOf())) throw new TypeError('invalid date'); return date.toISOString(); };

export function deliveryPaths(options = {}) {
  const root = options.rootPath;
  if (!isAbsolute(root || '')) throw new TypeError('explicit absolute rootPath required');
  const rootPath = resolve(root);
  const paths = {
    statePath: options.statePath ?? join(rootPath, 'notification-delivery-state.json'),
    journalPath: options.journalPath ?? join(rootPath, 'notification-delivery-journal.jsonl'),
    outboxPath: options.outboxPath ?? join(rootPath, 'notification-outbox.jsonl'),
  };
  for (const [key, path] of Object.entries(paths)) {
    if (!isAbsolute(path)) throw new TypeError('delivery paths must be absolute');
    const resolvedPath = resolve(path);
    const rel = relative(rootPath, resolvedPath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new TypeError('delivery paths must be under rootPath');
    paths[key] = resolvedPath;
  }
  return { rootPath, ...paths };
}

export function createDeliveryState(options = {}) {
  const now = iso(options.now);
  return { version: 1, paused: false, pauseReason: null, deliveries: {}, health: { status: 'never_run', attempted: 0, delivered: 0, failed: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: null }, createdAt: now, updatedAt: now };
}

function appendRecord(path, record) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 }); return record; }
export function appendDeliveryJournal(event, options = {}) { const paths = deliveryPaths(options); return appendRecord(paths.journalPath, { eventId: randomUUID(), occurredAt: iso(options.now), ...clone(event) }); }
export function readDeliveryJournal(options = {}) { const path = deliveryPaths(typeof options === 'string' ? { rootPath: options } : options).journalPath; return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []; }
export function loadDeliveryState(options = {}) { const path = deliveryPaths(typeof options === 'string' ? { rootPath: options } : options).statePath; if (!existsSync(path)) return createDeliveryState(); return JSON.parse(readFileSync(path, 'utf8')); }
export function saveDeliveryState(state, options = {}) { const paths = deliveryPaths(options); atomicWriteJson(paths.statePath, state); return paths.statePath; }

/** Explicit adapter boundary. This adapter only appends payloads to a local JSONL outbox. */
export function createLocalJsonlAdapter(options = {}) {
  const path = deliveryPaths(options).outboxPath;
  return { name: options.name ?? 'local-jsonl', async deliver(payload, context = {}) { appendRecord(path, { deliveredAt: iso(context.now), channel: this.name, notificationId: payload.id, payload: clone(payload) }); return { accepted: true, channel: this.name }; } };
}

function adaptersFrom(channels, options) {
  if (channels === undefined) return [];
  if (!Array.isArray(channels)) throw new TypeError('channels must be an array');
  return channels.map((item) => { if (!item || typeof item.deliver !== 'function' || typeof item.name !== 'string') throw new TypeError('channel adapter requires name and deliver'); return item; });
}

export async function deliverNotifications(input = {}) {
  const now = iso(input.now); const paths = deliveryPaths(input); const state = clone(input.state ?? loadDeliveryState(paths));
  const notifications = Array.isArray(input.notifications) ? input.notifications : [];
  const adapters = adaptersFrom(input.channels, paths);
  const maxAttempts = Math.max(1, Number(input.maxAttempts ?? 3));
  if (state.paused) return { state, results: [], health: { ...state.health, status: 'paused' } };
  const results = [];
  for (const payload of notifications) {
    if (!payload?.id) continue;
    const prior = state.deliveries[payload.id];
    if (prior?.status === 'delivered') { results.push({ notificationId: payload.id, status: 'duplicate' }); continue; }
    if (!adapters.length) { results.push({ notificationId: payload.id, status: 'pending', reason: 'no_channels_configured' }); continue; }
    const channels = {};
    for (const adapter of adapters) {
      const previous = prior?.channels?.[adapter.name];
      if (previous?.status === 'delivered') { channels[adapter.name] = previous; continue; }
      let attempt = previous?.attempts ?? 0; let delivered = false; let lastError = null;
      while (attempt < maxAttempts && !delivered) { attempt++; try { const response = await adapter.deliver(clone(payload), { now, notificationId: payload.id }); delivered = response?.accepted !== false; if (!delivered) lastError = response?.error ?? 'adapter rejected delivery'; } catch (error) { lastError = error?.message ?? String(error); } }
      channels[adapter.name] = { status: delivered ? 'delivered' : 'failed', attempts: attempt, lastError, deliveredAt: delivered ? now : null };
    }
    const delivered = Object.values(channels).some((item) => item.status === 'delivered');
    state.deliveries[payload.id] = { notificationId: payload.id, payload: clone(payload), status: delivered ? 'delivered' : 'failed', channels, updatedAt: now };
    results.push({ notificationId: payload.id, status: state.deliveries[payload.id].status, channels });
    appendDeliveryJournal({ type: 'notification_delivery', notificationId: payload.id, status: state.deliveries[payload.id].status, channels }, { ...paths, now });
  }
  const attempted = results.filter((r) => r.status !== 'duplicate' && r.status !== 'pending').length;
  const delivered = Object.values(state.deliveries).filter((d) => d.status === 'delivered').length;
  const failed = Object.values(state.deliveries).filter((d) => d.status === 'failed').length;
  state.health = { ...state.health, status: failed ? 'degraded' : (attempted ? 'healthy' : 'idle'), attempted: state.health.attempted + attempted, delivered, failed, lastAttemptAt: attempted ? now : state.health.lastAttemptAt, lastSuccessAt: delivered ? now : state.health.lastSuccessAt, lastError: failed ? 'one or more notifications failed' : null };
  state.updatedAt = now;
  if (input.persist !== false) saveDeliveryState(state, paths);
  return { state, results, health: clone(state.health) };
}

export function getDeliveryHealth(state) { return clone(state?.health ?? loadDeliveryState().health); }
export default { deliveryPaths, createDeliveryState, loadDeliveryState, saveDeliveryState, appendDeliveryJournal, readDeliveryJournal, createLocalJsonlAdapter, deliverNotifications, getDeliveryHealth };
