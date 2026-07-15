# FetchWatch

Poll a copied **cURL** or **JavaScript `fetch(...)`** request from browser DevTools, deep-diff the response, and fire a native desktop notification when it changes.

## Requirements

- Node.js **21+**
- npm

## Install locally (development)

```bash
npm install
npm run build
```

Run once:

```bash
npm start
```

Or link the binary globally for `fetchwatch` / testing like an installed package:

```bash
npm link
fetchwatch
```

Unlink when finished:

```bash
npm unlink -g fetchwatch
```

## How to use

1. Open DevTools → Network → copy as **cURL** or **fetch**.
2. Run `fetchwatch` (or `npx fetchwatch` after publish).
3. Paste the request and press **Enter on an empty line** to finish the paste.
4. Choose a polling interval in **seconds** (default `120`). While typing, the prompt shows the equivalent in minutes (e.g. `120s = 2.0 min`).
5. Optionally ignore minor dynamic JSON fields (timestamps, nonces, request IDs, etc.).
6. FetchWatch sends the initial request, then polls. On change it prints a colored diff, shows a desktop notification, and pauses until you press **R** (resume) or **E** (exit).
7. Press **Ctrl+C** anytime to quit cleanly.

### Multi-line paste UX

- Paste can span multiple lines (common for DevTools cURL / fetch copy).
- Type or paste your request at the `>` prompt.
- Finish by pressing **Enter** on a blank line (i.e. Enter twice at the end).

## Publish for `npx fetchwatch`

1. Update `version` in `package.json` if needed.
2. Log in to npm: `npm login`
3. Publish:

```bash
npm publish
```

`prepublishOnly` runs `npm run build` automatically. Only the `dist/` folder is included via `"files": ["dist"]`.

Users can then run:

```bash
npx fetchwatch
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run `node dist/index.js` |
| `npm run prepublishOnly` | Build before publish |

## Project layout

```
src/
  index.ts      CLI entry (banner, prompts, orchestrator)
  parser.ts     cURL / fetch → { url, method, headers, body }
  poller.ts     Interval loop, fetch, JSON/text diff
  notifier.ts   Desktop notifications + terminal styling
  types.ts      Shared types
```

## Notes

- Uses native Node.js `fetch` (no axios / node-fetch).
- Network errors during polling are logged as warnings; polling continues. A failed **initial** request exits.
- Desktop notifications depend on `node-notifier` and your OS notification center.
