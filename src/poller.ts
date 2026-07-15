import type { DiffChange, PollConfig } from "./types.js";
import {
  logError,
  logInfo,
  logMuted,
  logSuccess,
  logWarn,
  notifyChange,
  printDiffChanges,
  printTextDiff,
  waitForResumeOrExit,
} from "./notifier.js";

const DYNAMIC_KEY_PATTERNS = [
  /^timestamp$/i,
  /^timestamps$/i,
  /^updated[_-]?at$/i,
  /^created[_-]?at$/i,
  /^deleted[_-]?at$/i,
  /^time$/i,
  /^date$/i,
  /^datetime$/i,
  /^nonce$/i,
  /^etag$/i,
  /^request[_-]?id$/i,
  /^trace[_-]?id$/i,
  /^correlation[_-]?id$/i,
  /^session[_-]?id$/i,
  /^seq(uence)?([_-]?id)?$/i,
  /^uuid$/i,
  /^expires?[_-]?(at|in)?$/i,
  /^ttl$/i,
  /^server[_-]?time$/i,
  /^last[_-]?modified$/i,
];

export async function startPolling(config: PollConfig): Promise<void> {
  const { request, intervalMs, ignoreDynamicFields } = config;

  logInfo(`Sending initial request → ${request.method} ${request.url}`);

  let baseline: Snapshot;
  try {
    baseline = await executeRequest(request);
  } catch (err) {
    logError(
      `Initial request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }

  logSuccess(
    `Initial response OK (HTTP ${baseline.status}, ${baseline.body.length} bytes)`
  );
  logMuted(
    `Polling every ${intervalMs / 1000}s. Press Ctrl+C to stop.`
  );

  let stopped = false;
  const onSigInt = (): void => {
    stopped = true;
    console.log();
    logInfo("Stopped. Goodbye!");
    process.exit(0);
  };
  process.on("SIGINT", onSigInt);

  try {
    while (!stopped) {
      await sleep(intervalMs);
      if (stopped) break;

      let current: Snapshot;
      try {
        current = await executeRequest(request);
      } catch (err) {
        logWarn(
          `Poll failed (will retry): ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }

      const comparison = compareSnapshots(
        baseline,
        current,
        ignoreDynamicFields
      );

      if (!comparison.changed) {
        logMuted(
          `[${new Date().toLocaleTimeString()}] No change (HTTP ${current.status})`
        );
        continue;
      }

      logWarn(`[${new Date().toLocaleTimeString()}] Response changed!`);

      if (comparison.mode === "json" && comparison.changes) {
        printDiffChanges(comparison.changes);
      } else if (comparison.mode === "text") {
        printTextDiff(baseline.body, current.body);
      } else if (comparison.mode === "status") {
        logInfo(
          `Status: ${baseline.status} → ${current.status}`
        );
      }

      notifyChange(request.url);

      const resume = await waitForResumeOrExit();
      if (!resume) {
        logInfo("Exiting.");
        break;
      }

      // Resume from the latest response as the new baseline
      baseline = current;
    }
  } finally {
    process.off("SIGINT", onSigInt);
  }
}

interface Snapshot {
  status: number;
  contentType: string;
  body: string;
  isJson: boolean;
  json?: unknown;
}

async function executeRequest(
  request: PollConfig["request"]
): Promise<Snapshot> {
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };

  if (
    request.body !== undefined &&
    request.method.toUpperCase() !== "GET" &&
    request.method.toUpperCase() !== "HEAD"
  ) {
    init.body = request.body;
  }

  const response = await fetch(request.url, init);
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = isJsonContent(contentType, body);

  let json: unknown | undefined;
  if (isJson) {
    try {
      json = JSON.parse(body);
    } catch {
      // Treat as text if body isn't valid JSON
      return {
        status: response.status,
        contentType,
        body,
        isJson: false,
      };
    }
  }

  return {
    status: response.status,
    contentType,
    body,
    isJson: Boolean(isJson && json !== undefined),
    json,
  };
}

function isJsonContent(contentType: string, body: string): boolean {
  if (/application\/json|[^;/]+\/.*\+json/i.test(contentType)) {
    return true;
  }
  const trimmed = body.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

interface CompareResult {
  changed: boolean;
  mode: "json" | "text" | "status" | "none";
  changes?: DiffChange[];
}

function compareSnapshots(
  previous: Snapshot,
  current: Snapshot,
  ignoreDynamicFields: boolean
): CompareResult {
  if (previous.status !== current.status) {
    return { changed: true, mode: "status" };
  }

  if (previous.isJson && current.isJson) {
    const a = ignoreDynamicFields
      ? stripDynamicFields(previous.json)
      : previous.json;
    const b = ignoreDynamicFields
      ? stripDynamicFields(current.json)
      : current.json;

    const changes = deepDiff(a, b);
    return {
      changed: changes.length > 0,
      mode: "json",
      changes,
    };
  }

  if (previous.body !== current.body) {
    return { changed: true, mode: "text" };
  }

  return { changed: false, mode: "none" };
}

export function stripDynamicFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDynamicFields);
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (isDynamicKey(key)) continue;
      out[key] = stripDynamicFields(child);
    }
    return out;
  }

  return value;
}

function isDynamicKey(key: string): boolean {
  return DYNAMIC_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function deepDiff(
  previous: unknown,
  current: unknown,
  path = "$"
): DiffChange[] {
  const changes: DiffChange[] = [];

  if (Object.is(previous, current)) {
    return changes;
  }

  const prevIsObj = isPlainObject(previous) || Array.isArray(previous);
  const currIsObj = isPlainObject(current) || Array.isArray(current);

  if (!prevIsObj || !currIsObj || Array.isArray(previous) !== Array.isArray(current)) {
    changes.push({ kind: "changed", path, from: previous, to: current });
    return changes;
  }

  if (Array.isArray(previous) && Array.isArray(current)) {
    const max = Math.max(previous.length, current.length);
    for (let i = 0; i < max; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= previous.length) {
        changes.push({ kind: "added", path: childPath, value: current[i] });
      } else if (i >= current.length) {
        changes.push({ kind: "removed", path: childPath, value: previous[i] });
      } else {
        changes.push(...deepDiff(previous[i], current[i], childPath));
      }
    }
    return changes;
  }

  const prevObj = previous as Record<string, unknown>;
  const currObj = current as Record<string, unknown>;
  const keys = new Set([...Object.keys(prevObj), ...Object.keys(currObj)]);

  for (const key of keys) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (!(key in prevObj)) {
      changes.push({ kind: "added", path: childPath, value: currObj[key] });
    } else if (!(key in currObj)) {
      changes.push({ kind: "removed", path: childPath, value: prevObj[key] });
    } else {
      changes.push(...deepDiff(prevObj[key], currObj[key], childPath));
    }
  }

  return changes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
