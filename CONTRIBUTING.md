# Contributing to Barosaurus

Thanks for your interest! Issues and pull requests are welcome.

## Bugs & ideas

Open an [issue](https://github.com/polygonhunter/barosaurus/issues) — a short description, your Obsidian version, your platform (phone, tablet, desktop), and what you typed into the bar help a lot.

## Development setup

```bash
npm install
npm run dev     # watch build into test-vault/ (pjeby/hot-reload)
npm run test    # vitest over src/core
npm run build   # type-check + production bundle
```

Open `test-vault/` in Obsidian to try your changes live (the [hot-reload](https://github.com/pjeby/hot-reload) plugin picks up dev builds automatically).

## Ground rules

- Everything under `src/core/` stays pure (no `obsidian` imports) and unit-tested — ranking, query parsing, frecency, the catalog and the page stack all need a test.
- The UI follows one principle: **radically clean**. One field, one list. If a change adds visible chrome, it probably needs rethinking.
- Only public Obsidian APIs, and only APIs available in Obsidian 1.12 (`@since` tags in `obsidian.d.ts` are the source of truth). The unavoidable internals are quarantined in `src/ui/unsafe.ts` and must degrade gracefully when they disappear.
- Keep examples and fixtures fictional (no real names, vaults, or URLs).
