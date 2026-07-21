# AfterPrompt quickstart

## Requirements

- Node.js 22 or newer
- npm (the repository tracks `package-lock.json`)
- A current desktop browser; Chrome/Chromium is required only for real-browser checks

## First success

```bash
npm install
npm run dev
```

Open the Vite URL, normally <http://localhost:4173>. Choose **Import → Examples → AI slide**, select the title, make a visible text/style/position change, expand the source panel, and preview or export HTML. The repository also includes `multi-page-deck.html`, `simple-page.html`, and `shapes.svg` under `examples/`.

## Verify

```bash
npm run check
npm run cli -- --help
```

Optional real-browser verification:

```bash
CHROME_PATH=/path/to/chrome npm run test:browser
```

The browser editor stores layout preferences locally. A connected fragment directory remains user-owned; IndexedDB is only a temporary fragment clipboard.
