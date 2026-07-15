import notifier from "node-notifier";
import pc from "picocolors";
import readline from "node:readline";
import type { DiffChange } from "./types.js";

export function logInfo(message: string): void {
  console.log(pc.cyan(`ℹ ${message}`));
}

export function logSuccess(message: string): void {
  console.log(pc.green(`✔ ${message}`));
}

export function logWarn(message: string): void {
  console.log(pc.yellow(`⚠ ${message}`));
}

export function logError(message: string): void {
  console.error(pc.red(`✖ ${message}`));
}

export function logMuted(message: string): void {
  console.log(pc.dim(message));
}

export function printBanner(): void {
  const title = "FetchWatch";
  const subtitle = "Poll · Diff · Notify";
  const width = Math.max(title.length, subtitle.length) + 4;
  const line = "─".repeat(width);

  console.log();
  console.log(pc.bold(pc.magenta(`┌${line}┐`)));
  console.log(
    pc.bold(pc.magenta("│")) +
      pc.bold(pc.white(`  ${title.padEnd(width - 2)}`)) +
      pc.bold(pc.magenta("│"))
  );
  console.log(
    pc.bold(pc.magenta("│")) +
      pc.dim(`  ${subtitle.padEnd(width - 2)}`) +
      pc.bold(pc.magenta("│"))
  );
  console.log(pc.bold(pc.magenta(`└${line}┘`)));
  console.log();
}

export function notifyChange(url: string): void {
  process.stdout.write("\x07");
  notifier.notify({
    title: "CLI-FetchWater",
    message: `The response for [${url}] has changed!`,
    sound: true,
    wait: false,
    appID: "CLI-FetchWater",
  });
}

export function printDiffChanges(changes: DiffChange[]): void {
  console.log();
  console.log(pc.bold(pc.yellow("Changes detected:")));
  for (const change of changes) {
    if (change.kind === "added") {
      console.log(
        pc.green(`  + ${change.path}: ${formatValue(change.value)}`)
      );
    } else if (change.kind === "removed") {
      console.log(pc.red(`  - ${change.path}: ${formatValue(change.value)}`));
    } else {
      console.log(
        pc.red(`  - ${change.path}: ${formatValue(change.from)}`) +
          " → " +
          pc.green(formatValue(change.to))
      );
    }
  }
  console.log();
}

export function printTextDiff(previous: string, next: string): void {
  const prevLines = previous.split("\n");
  const nextLines = next.split("\n");
  const max = Math.max(prevLines.length, nextLines.length);

  console.log();
  console.log(pc.bold(pc.yellow("Text diff:")));
  for (let i = 0; i < max; i++) {
    const a = prevLines[i];
    const b = nextLines[i];
    if (a === b) continue;
    if (a !== undefined && b === undefined) {
      console.log(pc.red(`  - ${a}`));
    } else if (a === undefined && b !== undefined) {
      console.log(pc.green(`  + ${b}`));
    } else {
      console.log(pc.red(`  - ${a}`));
      console.log(pc.green(`  + ${b}`));
    }
  }
  console.log();
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Pause after a change until the user chooses Resume or Exit.
 * Returns true to resume, false to exit.
 */
export async function waitForResumeOrExit(): Promise<boolean> {
  console.log(
    pc.bold(
      "Watching paused. Press " +
        pc.green("R") +
        " to resume, or " +
        pc.red("E") +
        " to exit."
    )
  );

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const onKeypress = (str: string, key: readline.Key): void => {
      if (key?.ctrl && key.name === "c") {
        cleanup();
        resolve(false);
        return;
      }

      const ch = (str || key?.name || "").toLowerCase();
      if (ch === "r") {
        cleanup();
        logSuccess("Resuming watch…");
        resolve(true);
      } else if (ch === "e") {
        cleanup();
        resolve(false);
      }
    };

    function cleanup(): void {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.off("keypress", onKeypress);
      rl.close();
    }

    readline.emitKeypressEvents(process.stdin, rl);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", onKeypress);
  });
}
