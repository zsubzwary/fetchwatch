#!/usr/bin/env node
import prompts from "prompts";
import readline from "node:readline";
import pc from "picocolors";
import { parseRequest } from "./parser.js";
import { startPolling } from "./poller.js";
import {
  logError,
  logInfo,
  logSuccess,
  printBanner,
} from "./notifier.js";

async function main(): Promise<void> {
  printBanner();

  const rawRequest = await readMultilinePaste();
  if (!rawRequest.trim()) {
    logError("No request pasted. Exiting.");
    process.exit(1);
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
