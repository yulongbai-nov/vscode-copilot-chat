# Simulation Cache Hydration

This fork does **not** store the SQLite cache blobs that upstream keeps in Git LFS.
The automated sync drops any `*.sqlite` files before pushing so that the fork
only contains source code. When you need the cache locally (for example,
before running `npm install` or the simulation tests), hydrate it from the
upstream repository:

```bash
npx --yes tsx script/hydrateSimulationCache.ts
```

The helper script fetches the latest pointers from `upstream/main`, downloads
the required Git LFS objects directly from the upstream remote, and writes the
SQLite databases into this directory. The files are ignored by Git, so they can
be safely removed with `git clean -xfd` whenever you want to reclaim space.
