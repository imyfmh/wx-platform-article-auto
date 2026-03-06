# wx-platform-article-auto

A single-skill repository for `wechat-article-pipeline`, used to automate:

`topic -> Markdown article -> WeChat HTML -> WeChat draft`

## Included Skill

- `skill/wechat-article-pipeline`

## What This Skill Orchestrates

1. Use `article-assistant` as the article-writing entry point.
2. Optionally generate a cover with `auto-cover-selector` when no cover is provided.
3. Render Markdown to WeChat-compatible HTML via `wechat-markdown-renderer`.
4. Publish to WeChat draft box via `wechat-mp-draft-publisher`.

## Notes

- Writing is delegated to `article-assistant`, which internally orchestrates research, outline, draft, polish, fact-check, and image-link curation.
- This pipeline publishes to draft only and does not submit free publish.

## Local Verify (Optional)

```bash
npm --prefix skill/wechat-article-pipeline run verify
```
