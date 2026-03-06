---
name: auto-cover-selector
description: Automatically select and download a cover image that matches an article by searching Pexels and Pixabay with API keys from ~/.pw, then save a local JPEG/PNG for downstream publishing.
---

# Auto Cover Selector

Use this skill when the task is: `article title/summary -> local cover image file`.

## Inputs

Collect:

1. Article title
2. Optional digest or markdown file path for more context
3. Optional output path
4. Optional credentials file path
   - defaults to `~/.pw`
   - reads `[pexels] apiKey = ...` and `[pixabay] apiKey = ...`

## Workflow

1. Extract search terms from the title, digest, and markdown.
2. Search Pexels and Pixabay for horizontal cover candidates.
3. Score candidates for relevance and cover suitability.
4. Download the best image as a local `.jpg` or `.png`.
5. Return the local cover file path plus source metadata.

## CLI

```bash
node --experimental-strip-types ~/.codex/skills/auto-cover-selector/scripts/select-cover.ts --title "文章标题" --digest "文章摘要" --output /abs/path/article.cover
```

- add `--markdown /abs/path/article.md` when available
- add `--credentials /abs/path/file` only when not using `~/.pw`

## Output

- `coverPath`
- `provider`
- `query`
- `sourceUrl`

## Behavior

- Prefers Pexels, then Pixabay, when scores are close
- Saves only local files for downstream publish steps
- If neither API key is available or no suitable image is found, fail clearly so the caller can decide whether to fall back
