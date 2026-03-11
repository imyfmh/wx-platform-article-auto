---
name: wechat-article-pipeline
description: Orchestrate article writing, markdown-to-wechat-html conversion, and WeChat draft creation by collecting a credentials file path plus the article topic, then chaining article generation, HTML rendering, and draft publishing skills. Use when the user wants one-step 自动写文章并发布到公众号草稿箱.
---

# WeChat Article Pipeline

Use this skill when the task is: `topic -> markdown article -> WeChat HTML -> WeChat draft`.

This is an orchestrator skill. It does not own the renderer or publisher runtime. It coordinates:

1. `$article-assistant` (required article writer)
2. `$auto-cover-selector`
3. `$wechat-markdown-renderer`
4. `$wechat-mp-draft-publisher`

## Required Inputs

Collect these before running:

1. Credentials file path
   - defaults to `~/.pw`
   - only ask for another path if the user wants to override it
2. Article topic and requirements
   - target audience
   - tone
   - length or scope if provided (if not provided, default to about 600 Chinese characters)

Optional but preferred:

3. Cover image path or URL
   - if absent, the pipeline should try `$auto-cover-selector` first
   - if auto-cover is unavailable or finds nothing, the publisher should fall back to the first article image as the cover source

## Workflow

1. Use `$article-assistant` as the only article-writing entry point.
   - Do not directly run `topic-research` / `article-outline` / `article-draft` / `article-polish` in this skill.
   - Pass user requirements (topic, audience, tone, length/scope, constraints) to `$article-assistant`.
   - If the user does not specify length/scope, pass the default length target: about 600 Chinese characters.
   - Enforce that the writing stage strictly follows `../article-assistant/references/custom-writing-prompt.md` (resolved from `$article-assistant` skill directory).
   - Do not introduce additional writing-style prompts in this pipeline skill.
   - Require `$article-assistant` to return exactly one final Markdown file path saved under the current working directory.
2. If the user did not provide a cover, try `$auto-cover-selector`.
   - default credentials path is still `~/.pw`
   - read `[pexels] apiKey = ...` and `[pixabay] apiKey = ...`
   - save the generated cover file in the current working directory
3. Convert that Markdown file with `$wechat-markdown-renderer`.
4. Build a draft job file in the current working directory.
   - `htmlPath`: renderer output
   - `title`: article H1
   - `digest`: first concise summary paragraph or user-provided summary
   - `thumbImagePath`: explicit cover source if available; otherwise omit it and let the publisher use the first article image
   - `author`: if the user specifies one
5. Use the helper script to generate `draft-job.yaml` and publish immediately:

```bash
pnpm --dir ~/.codex/skills/wechat-article-pipeline run publish-draft -- --markdown /abs/path/article.md --html /abs/path/article.wechat.html
```

   - the helper script tolerates the extra `--` that `pnpm run` forwards before user arguments
   - add `--credentials /abs/path/file` only when not using `~/.pw`
   - add `--cover /abs/path/cover.png` only when overriding first-image fallback
6. The helper script writes `draft-job.yaml`, writes the publish result JSON, and publishes to the draft box through `$wechat-mp-draft-publisher`.
7. Return:
   - markdown file path
   - final cover file path when auto-generated
   - final HTML path
   - draft job file path
   - WeChat `media_id`

## Constraints

- Publish only to the draft box
- Do not attempt `freepublish/submit`
- If the article has no usable image and no explicit cover source, stop and ask for one
- Keep all generated files under the current working directory
- The writing stage must be delegated to `$article-assistant`; do not bypass it with direct sub-skill orchestration in this pipeline
