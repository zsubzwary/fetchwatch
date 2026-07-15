import type { ParsedRequest } from "./types.js";

/**
 * Parse a raw cURL command or JavaScript fetch(...) snippet into a request config.
 */
export function parseRequest(raw: string): ParsedRequest {
  const input = raw.trim();
  if (!input) {
    throw new Error("Empty request. Paste a cURL command or fetch(...) call.");
  }

  if (looksLikeCurl(input)) {
    return parseCurl(input);
  }

  if (looksLikeFetch(input)) {
    return parseFetch(input);
  }

  throw new Error(
    "Could not detect request type. Paste a cURL command (starting with curl) or a JavaScript fetch(...) call."
  );
}

function looksLikeCurl(input: string): boolean {
  return /^\s*curl\b/i.test(input) || /\bcurl\s+['"]?https?:\/\//i.test(input);
}

function looksLikeFetch(input: string): boolean {
  return /\bfetch\s*\(/i.test(input);
}

function parseCurl(raw: string): ParsedRequest {
  const tokens = tokenizeCurl(raw);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Invalid cURL command: expected it to start with 'curl'.");
  }

  let url = "";
  let method = "";
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let user: string | undefined;
  let compressed = false;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "-X" || token === "--request") {
      method = requireNext(tokens, ++i, token).toUpperCase();
      continue;
    }

    if (token === "-H" || token === "--header") {
      const header = requireNext(tokens, ++i, token);
      const colon = header.indexOf(":");
      if (colon === -1) {
        throw new Error(`Invalid header (missing ':'): ${header}`);
      }
      const name = header.slice(0, colon).trim();
      const value = header.slice(colon + 1).trim();
      headers[name] = value;
      continue;
    }

    if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-ascii" ||
      token === "--data-urlencode"
    ) {
      const value = requireNext(tokens, ++i, token);
      body = body === undefined ? value : `${body}&${value}`;
      if (!method) method = "POST";
      continue;
    }

    if (token === "-u" || token === "--user") {
      user = requireNext(tokens, ++i, token);
      continue;
    }

    if (token === "-A" || token === "--user-agent") {
      headers["User-Agent"] = requireNext(tokens, ++i, token);
      continue;
    }

    if (token === "-e" || token === "--referer") {
      headers["Referer"] = requireNext(tokens, ++i, token);
      continue;
    }

    if (token === "-b" || token === "--cookie") {
      headers["Cookie"] = requireNext(tokens, ++i, token);
      continue;
    }

    if (token === "--url") {
      url = requireNext(tokens, ++i, token);
      continue;
    }

    if (token === "--compressed") {
      compressed = true;
      continue;
    }

    // Common no-op / ignored flags
    if (
      token === "-s" ||
      token === "--silent" ||
      token === "-S" ||
      token === "--show-error" ||
      token === "-i" ||
      token === "--include" ||
      token === "-L" ||
      token === "--location" ||
      token === "-k" ||
      token === "--insecure" ||
      token === "-v" ||
      token === "--verbose" ||
      token === "-#" ||
      token === "--progress-bar" ||
      token === "-N" ||
      token === "--no-buffer"
    ) {
      continue;
    }

    // Flags that take a value we intentionally skip
    if (
      token === "-o" ||
      token === "--output" ||
      token === "-w" ||
      token === "--write-out" ||
      token === "--connect-timeout" ||
      token === "--max-time" ||
      token === "-m" ||
      token === "--proxy" ||
      token === "-x" ||
      token === "--cacert" ||
      token === "--cert" ||
      token === "--key" ||
      token === "-E"
    ) {
      i++; // skip value
      continue;
    }

    if (token.startsWith("-")) {
      // Unknown short/long flag — skip optional value if next token isn't a flag/url-looking
      continue;
    }

    if (!url) {
      url = token;
    }
  }

  if (!url) {
    throw new Error("Could not find a URL in the cURL command.");
  }

  url = stripQuotes(url);
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  if (user) {
    const encoded = Buffer.from(user, "utf8").toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
  }

  if (compressed && !hasHeader(headers, "Accept-Encoding")) {
    headers["Accept-Encoding"] = "gzip, deflate, br";
  }

  if (body !== undefined && !hasHeader(headers, "Content-Type")) {
    // Infer content type from body shape
    const trimmed = body.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      headers["Content-Type"] = "application/json";
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  }

  return {
    url,
    method: (method || "GET").toUpperCase(),
    headers,
    body,
  };
}

function tokenizeCurl(raw: string): string[] {
  // Normalize line continuations and newlines into spaces
  const normalized = raw
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === "\\" && quote !== "'") {
      // Outside single quotes, backslash escapes next char
      escape = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (quote) {
    throw new Error("Unterminated quote in cURL command.");
  }
  if (escape) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function requireNext(tokens: string[], index: number, flag: string): string {
  if (index >= tokens.length) {
    throw new Error(`Missing value after ${flag}`);
  }
  return tokens[index];
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFetch(raw: string): ParsedRequest {
  // Extract the argument list inside the first fetch(...)
  const call = extractFetchCall(raw);
  if (!call) {
    throw new Error("Could not parse fetch(...) call.");
  }

  const args = splitTopLevelArgs(call);
  if (args.length === 0) {
    throw new Error("fetch() requires a URL as the first argument.");
  }

  const url = unquoteString(args[0].trim());
  if (!url) {
    throw new Error("Could not parse the fetch URL.");
  }

  let method = "GET";
  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (args.length >= 2) {
    const options = parseObjectLiteral(args[1].trim());
    if (options.method) {
      method = unquoteString(options.method).toUpperCase();
    }
    if (options.headers) {
      const headerObj = parseObjectLiteral(options.headers);
      for (const [key, value] of Object.entries(headerObj)) {
        headers[unquoteString(key)] = unquoteString(value);
      }
    }
    if (options.body !== undefined && options.body.trim() !== "null") {
      body = unquoteString(options.body);
    }
  }

  return { url, method, headers, body };
}

function extractFetchCall(raw: string): string | null {
  const match = raw.match(/\bfetch\s*\(/i);
  if (!match || match.index === undefined) return null;

  const start = match.index + match[0].length;
  let depth = 1;
  let quote: '"' | "'" | "`" | null = null;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i);
      }
    }
  }

  return null;
}

function splitTopLevelArgs(argsSource: string): string[] {
  const args: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escape = false;

  for (let i = 0; i < argsSource.length; i++) {
    const ch = argsSource[i];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "(") depthParen++;
    if (ch === ")") depthParen--;
    if (ch === "{") depthBrace++;
    if (ch === "}") depthBrace--;
    if (ch === "[") depthBracket++;
    if (ch === "]") depthBracket--;

    if (
      ch === "," &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0
    ) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function parseObjectLiteral(source: string): Record<string, string> {
  let text = source.trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    text = text.slice(1, -1).trim();
  }

  const result: Record<string, string> = {};
  if (!text) return result;

  const entries = splitObjectEntries(text);
  for (const entry of entries) {
    const colon = findTopLevelColon(entry);
    if (colon === -1) continue;
    const key = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim();
    result[key.replace(/^['"`]|['"`]$/g, "")] = value;
  }

  return result;
}

function splitObjectEntries(text: string): string[] {
  const entries: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "(") depthParen++;
    if (ch === ")") depthParen--;
    if (ch === "{") depthBrace++;
    if (ch === "}") depthBrace--;
    if (ch === "[") depthBracket++;
    if (ch === "]") depthBracket--;

    if (
      ch === "," &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0
    ) {
      if (current.trim()) entries.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) entries.push(current.trim());
  return entries;
}

function findTopLevelColon(entry: string): number {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escape = false;

  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") depthParen++;
    if (ch === ")") depthParen--;
    if (ch === "{") depthBrace++;
    if (ch === "}") depthBrace--;
    if (ch === "[") depthBracket++;
    if (ch === "]") depthBracket--;

    if (
      ch === ":" &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0
    ) {
      return i;
    }
  }

  return -1;
}

function unquoteString(value: string): string {
  let text = value.trim();

  // Handle JSON.stringify("...") wrappers sometimes copied from DevTools
  const stringifyMatch = text.match(
    /^JSON\.stringify\s*\(\s*([\s\S]*)\s*\)\s*$/i
  );
  if (stringifyMatch) {
    try {
      // Prefer evaluating as JSON object/array/string literal
      const inner = stringifyMatch[1].trim();
      if (
        (inner.startsWith("{") && inner.endsWith("}")) ||
        (inner.startsWith("[") && inner.endsWith("]"))
      ) {
        // Convert relaxed JS object to JSON-ish: this is best-effort
        return JSON.stringify(Function(`"use strict"; return (${inner});`)());
      }
      return unquoteString(inner);
    } catch {
      return stringifyMatch[1].trim();
    }
  }

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    const quote = text[0];
    text = text.slice(1, -1);
    if (quote === '"') {
      try {
        return JSON.parse(`"${text}"`);
      } catch {
        return text.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    return text
      .replace(/\\'/g, "'")
      .replace(/\\`/g, "`")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }

  // Bare object/array literal used as body — leave as stringified source
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      return JSON.stringify(Function(`"use strict"; return (${text});`)());
    } catch {
      return text;
    }
  }

  return text;
}
