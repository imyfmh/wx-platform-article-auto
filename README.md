# wx-platform-article-auto

WeChat article automation skill bundle.

This repository contains the complete 11-skill chain for:

`topic -> markdown article -> WeChat HTML -> WeChat draft`

## Included Skills (11)

1. `skill/wechat-article-pipeline`
2. `skill/article-assistant`
3. `skill/topic-research`
4. `skill/article-outline`
5. `skill/article-draft`
6. `skill/article-polish`
7. `skill/fact-check`
8. `skill/image-link-curator`
9. `skill/auto-cover-selector`
10. `skill/wechat-markdown-renderer`
11. `skill/wechat-mp-draft-publisher`

## Orchestration Flow

1. `wechat-article-pipeline` collects topic and credentials.
2. Writing is delegated to `article-assistant`.
3. `article-assistant` internally orchestrates:
   - `topic-research -> article-outline -> article-draft -> article-polish -> fact-check -> image-link-curator`
4. `wechat-markdown-renderer` converts markdown to WeChat HTML.
5. `wechat-mp-draft-publisher` publishes the result to WeChat draft box.
6. `auto-cover-selector` is used when no cover is provided.

## Notes

- The writing stage in pipeline is explicitly bound to `article-assistant`.
- Output target is WeChat draft only (not free publish).
- Runtime dependencies (`node_modules`) are intentionally excluded from this repository.

## One-Command Install

Specify only your local skills directory:

```bash
./scripts/install-skills.sh ~/.codex/skills
```

Optional: skip verify phase

```bash
./scripts/install-skills.sh ~/.codex/skills --skip-verify
```

What the installer does:

1. Copies all skills from `skill/` into your target skills directory.
2. Installs dependencies for every copied skill that has `package.json`.
3. Runs `verify` automatically for skills that expose a verify script.

## Quick Verify

```bash
npm --prefix skill/wechat-article-pipeline run verify
```
