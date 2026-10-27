#!/usr/bin/env node
/** Coordinates scan-state notification candidates with explicit local delivery. */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { appendDeliveryJournal, deliverNotifications, deliveryPaths, loadDeliveryState } from './notification-delivery.mjs';
import { atomicWriteJson, processScanRun } from './scan-state.mjs';

const iso = (value) => { const date = new Date(value ?? Date.now()); if (Number.isNaN(date.valueOf())) throw new TypeError('invalid date'); return date.toISOString(); };

export function createScheduleState(options = {}) { return { version: 1, lastRunAt: options.lastRunAt ? iso(options.lastRunAt) : null, updatedAt: iso(options.now) }; }
function schedulePath(options = {}) {
  const paths = deliveryPaths(options);
  const path = options.schedulePath ?? join(paths.rootPath, 'notification-schedule-state.json');
  if (!isAbsolute(path)) throw new TypeError('schedulePath must be absolute');
  const resolved = resolve(path);
  const rel = relative(paths.rootPath, resolved);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new TypeError('schedulePath must be under rootPath');
  return resolved;
}
export function loadScheduleState(options = {}) {
  const path = schedulePath(options);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : createScheduleState(options);
}
export function saveScheduleState(state, options = {}) {
  const path = schedulePath(options);
  atomicWriteJson(path, state);
  return path;
}

export function scheduleDue(options = {}) {
  if (options.paused) return false;
  if (!options.lastRunAt) return true;
  const intervalMs = Math.max(0, Number(options.intervalMs ?? 0));
  return new Date(options.now ?? Date.now()).valueOf() >= new Date(options.lastRunAt).valueOf() + intervalMs;
}

/** Process a scan result and deliver only the deterministic candidates it emits. */
export async function scheduleNotificationRun(options = {}) {
  if (!options.rootPath || !isAbsolute(options.rootPath)) throw new TypeError('explicit absolute rootPath required');
  if (!options.scanState) throw new TypeError('scanState is required');
  const paths = deliveryPaths(options);
  const now = iso(options.now);
  const due = options.force === true || scheduleDue({ paused: options.scanState.paused, lastRunAt: options.lastRunAt, intervalMs: options.intervalMs, now });
  if (!due) return { due: false, skipped: true, notifications: [], delivery: null, scan: null };
  const scan = processScanRun(options.scanState, options.roles ?? [], { ...options.scanOptions, now });
  const delivery = await deliverNotifications({
    ...options,
    rootPath: paths.rootPath,
    state: options.deliveryState,
    notifications: scan.notifications,
    channels: options.channels,
    maxAttempts: options.maxAttempts,
    now,
  });
  appendDeliveryJournal({ type: 'notification_schedule_run', scanRunAt: now, notificationIds: scan.notifications.map((item) => item.id), deliveryStatuses: delivery.results.map((item) => item.status) }, { ...paths, now });
  return { due: true, skipped: false, scan, notifications: scan.notifications, delivery, lastRunAt: now };
}

export class NotificationScheduler {
  constructor(options = {}) {
    this.options = { ...options };
    deliveryPaths(options);
    this.scheduleState = options.scheduleState ?? loadScheduleState(options);
    this.lastRunAt = options.lastRunAt ?? this.scheduleState.lastRunAt;
    this.deliveryState = options.deliveryState ?? loadDeliveryState(options);
  }
  async run(scanState, roles, options = {}) {
    const result = await scheduleNotificationRun({ ...this.options, ...options, scanState, roles, lastRunAt: options.lastRunAt ?? this.lastRunAt, deliveryState: this.deliveryState });
    if (result.due) {
      this.lastRunAt = result.lastRunAt;
      this.scheduleState = createScheduleState({ lastRunAt: this.lastRunAt, now: result.lastRunAt });
      this.deliveryState = result.delivery.state;
      if (this.options.rootPath || options.rootPath) saveScheduleState(this.scheduleState, { ...this.options, ...options });
    }
    return result;
  }
}

export default { createScheduleState, loadScheduleState, saveScheduleState, scheduleDue, scheduleNotificationRun, NotificationScheduler };
