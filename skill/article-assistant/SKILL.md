---
name: article-assistant
description: End-to-end Markdown article production orchestrator that plans, researches, outlines, drafts, polishes, fact-checks, and embeds image links with controlled display size. Use when users ask to write a complete article with images, request an “文章助手”, or want one-stop article delivery.
---

# Article Assistant

Run a full pipeline and output one final Markdown article file.

This skill can be called directly by users or used as the writing stage of `$wechat-article-pipeline`.

## Workflow

1. Define article goal, audience, tone, and target length.
2. Run research pass using topic-research workflow.
3. Build structure using article-outline workflow.
4. Draft full text using article-draft workflow.
5. Improve readability using article-polish workflow.
6. Validate key claims and dates using fact-check workflow.
7. Insert image links using image-link-curator workflow.
8. Save the final Markdown to the current Codex working directory.
9. Return only the saved file path by default (unless user asks for process logs).

## Integration contract for `$wechat-article-pipeline`

When invoked by `$wechat-article-pipeline`, treat these as required handoff rules:

1. Preserve the user's writing requirements (topic, audience, tone, length/scope, must-have points).
2. Generate exactly one final Markdown article.
3. Save the file under the current working directory.
4. Return only the final Markdown path so downstream steps can consume it directly.
5. Keep WeChat renderer compatibility:
   - one H1 at top
   - no standalone raw HTML image blocks like `<img ... />`
   - standard Markdown image syntax only

## Output contract

- Deliver valid Markdown.
- Use H1 once, then H2/H3 hierarchy.
- Do not prepend metadata labels at the top (no Title/Summary/Target Audience/Estimated Read Time block).
- Include a references section at bottom when external facts are used.
- Keep image embeds in standard Markdown image syntax:

```md
![ALT_TEXT](IMAGE_URL)
```

- When the article will be rendered by `$wechat-markdown-renderer`, do not emit standalone raw HTML image blocks such as `<img ... />`, because strict mode rejects them

- Place one image after intro and then every 2–4 sections when useful.
- Default filename format must include date + time to avoid collisions:
  - `article-YYYYMMDD-HHMMSS.md`
  - Example: `article-20260305-145901.md`
- Save path must be under current working directory (the directory where user runs Codex).
- Final response should only include the article file path unless the user explicitly asks for full content.
