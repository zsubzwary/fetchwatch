#!/usr/bin/env node
import prompts from "prompts";
import readline from "node:readline";
import { readFile } from "node:fs/promises";
import pc from "picocolors";
import { parseRequest } from "./parser.js";
import { startPolling } from "./poller.js";
import {
  logError,
  logInfo,
  logWarn,
  logSuccess,
  printBanner,
} from "./notifier.js";

interface UpdateInfo {
  current: string;
  latest: string;
}

const PACKAGE_NAME = "fetchwatch";
const NPM_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

async function main(): Promise<void> {
  printBanner();

  // Non-blocking update check: run in background, but only print after
  // the user has finished pasting their request (to avoid prompt mixing).
  let canPrintUpdateNotice = false;
  let pendingUpdateInfo: UpdateInfo | null = null;
  let updateNoticePrinted = false;
  void getUpdateInfo()
    .then((info) => {
      pendingUpdateInfo = info;
      if (info && canPrintUpdateNotice && !updateNoticePrinted) {
        updateNoticePrinted = true;
        logWarn(
          `A newer FetchWatch version is available: ${info.current} → ${info.latest}. ` +
            "Upgrade with `npx -y fetchwatch@latest` or reinstall."
        );
      }
    })
    .catch(() => {
      // Never block the CLI if the registry check fails.
    });

  const rawRequest = await readMultilinePaste();
  if (!rawRequest.trim()) {
    logError("No request pasted. Exiting.");
    process.exit(1);
  }

  canPrintUpdateNotice = true;
  if (pendingUpdateInfo && !updateNoticePrinted) {
    updateNoticePrinted = true;
    const info = pendingUpdateInfo as UpdateInfo;
    logWarn(
      `A newer FetchWatch version is available: ${info.current} → ${info.latest}. ` +
        "Upgrade with `npx -y fetchwatch@latest` or reinstall."
    );
  }

  let parsed;
  try {
    parsed = parseRequest(rawRequest);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  logSuccess(
    `Parsed ${parsed.method} ${parsed.url}` +
      (Object.keys(parsed.headers).length
        ? ` (${Object.keys(parsed.headers).length} headers)`
        : "")
  );

  const answers = await prompts(
    [
      {
        type: "number",
        name: "intervalSeconds",
        message: "Polling interval in seconds",
        initial: 120,
        min: 1,
        float: false,
        onState(state: { value?: number }) {
          const seconds =
            typeof state.value === "number" && !Number.isNaN(state.value)
              ? state.value
              : 120;
          const minutes = (seconds / 60).toFixed(1);
          // Update hint live so users see minutes while typing seconds
          this.message = `Polling interval in seconds ${pc.dim(
            `(${seconds}s = ${minutes} min)`
          )}`;
        },
        validate: (value: number) =>
          value >= 1 ? true : "Interval must be at least 1 second",
      },
      {
        type: "confirm",
        name: "ignoreDynamicFields",
        message:
          "Ignore minor dynamic JSON fields (timestamps, nonces, request IDs, etc.)?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        logInfo("Cancelled.");
        process.exit(0);
      },
    }
  );

  if (answers.intervalSeconds === undefined) {
    process.exit(0);
  }

  const intervalSeconds = Number(answers.intervalSeconds) || 120;
  const ignoreDynamicFields = Boolean(answers.ignoreDynamicFields);

  logInfo(
    `Starting watch every ${intervalSeconds}s (${(intervalSeconds / 60).toFixed(1)} min)` +
      (ignoreDynamicFields ? ", ignoring dynamic fields" : "")
  );

  await startPolling({
    request: parsed,
    intervalMs: intervalSeconds * 1000,
    ignoreDynamicFields,
  });
}

async function getUpdateInfo(): Promise<UpdateInfo | null> {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkgRaw = await readFile(pkgUrl, "utf8");
    const pkg = JSON.parse(pkgRaw) as { version?: unknown };
    const current = typeof pkg.version === "string" ? pkg.version : undefined;
    if (!current) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    try {
      const res = await fetch(NPM_LATEST_URL, {
        signal: controller.signal,
        headers: { "User-Agent": "fetchwatch-cli" },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { version?: unknown };
      const latest =
        typeof data.version === "string" ? data.version : undefined;
      if (!latest) return null;

      if (!isSemverNewer(latest, current)) return null;
      return { current, latest };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function isSemverNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  return compareSemver(a, b) > 0;
}

function parseSemver(
  version: string
): { major: number; minor: number; patch: number; prerelease?: string } | null {
  const trimmed = version.trim();
  // Keep this intentionally small: just enough for typical x.y.z versions.
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

function compareSemver(
  a: { major: number; minor: number; patch: number; prerelease?: string },
  b: { major: number; minor: number; patch: number; prerelease?: string }
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // If numeric parts are equal, treat a prerelease as older than a release.
  const aHasPre = Boolean(a.prerelease);
  const bHasPre = Boolean(b.prerelease);
  if (aHasPre !== bHasPre) return aHasPre ? -1 : 1;
  if (!aHasPre && !bHasPre) return 0;

  // Both prerelease: do a stable string comparison as a last resort.
  return String(a.prerelease).localeCompare(String(b.prerelease));
}

/**
 * Read a multi-line paste from stdin.
 * UX: paste the request, then press Enter on an empty line to finish.
 */
async function readMultilinePaste(): Promise<string> {
  console.log(
    pc.bold("Paste your cURL or fetch(...) request below.")
  );
  console.log(
    pc.dim(
      "Multi-line paste is supported. When done, press Enter on an empty line to continue."
    )
  );
  console.log();

  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.setPrompt(pc.dim("> "));
    rl.prompt();

    rl.on("line", (line) => {
      // Empty line ends input once the user has pasted something
      if (line === "" && lines.length > 0) {
        rl.close();
        return;
      }

      // Allow an immediate empty first line to mean "cancel" if followed by another empty —
      // but keep waiting so accidental enter is recoverable.
      lines.push(line);
      rl.prompt();
    });

    rl.on("close", () => {
      // Drop trailing empty lines
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      console.log();
      resolve(lines.join("\n"));
    });
  });
}

main().catch((err) => {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
