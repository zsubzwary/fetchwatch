export interface ParsedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PollConfig {
  request: ParsedRequest;
  intervalMs: number;
  ignoreDynamicFields: boolean;
}

export type DiffChange =
  | { kind: "added"; path: string; value: unknown }
  | { kind: "removed"; path: string; value: unknown }
  | { kind: "changed"; path: string; from: unknown; to: unknown };
