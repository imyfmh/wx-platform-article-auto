---
name: wechat-mp-draft-publisher
description: Publish WeChat-compatible HTML into a WeChat Official Account draft box using appid/appsecret credentials, cover upload, content-image upload, and cgi-bin/draft/add. Use when the user wants HTML -> 微信公众号草稿箱、公众号草稿创建、or a reusable draft-only publishing automation step.
---

# WeChat MP Draft Publisher

Use this skill when the task is: `WeChat-ready HTML -> WeChat Official Account draft`.

This skill is standalone. It calls the official WeChat API directly and does not rely on browser code or proxy functions.

## Inputs

Collect two files:

1. Credentials file path
   - optional on CLI; defaults to `~/.pw`
   - supports `~/.pw` INI format, YAML, or JSON
   - must contain `appId/appSecret` or `appid/secret`
2. Draft job file path
   - YAML or JSON
   - contains the HTML file path plus article metadata
   - `thumbImagePath` is optional; if omitted, the first `<img>` in the HTML is used as the cover source

Read `references/credentials.md` and `references/draft-job.md` when you need the schema details.

## Workflow

1. Confirm the HTML is already WeChat-compatible.
   - If the user starts from Markdown, use `$wechat-markdown-renderer` first.
2. Run the standalone draft publisher:

```bash
pnpm --dir ~/.codex/skills/wechat-mp-draft-publisher run publish -- --job /abs/path/draft-job.yaml --output /abs/path/draft-result.json
```

3. Return:
   - `media_id`
   - result JSON path if one was written
   - any clear failure cause from WeChat

## Behavior

- Calls official WeChat endpoints directly:
  - `cgi-bin/stable_token`
  - `cgi-bin/material/add_material`
  - `cgi-bin/media/uploadimg`
  - `cgi-bin/draft/add`
- Does not use proxy routes
- Does not attempt `freepublish/submit`
- Rewrites non-WeChat body image URLs by uploading them through `media/uploadimg`
- If `thumbImagePath` is missing, uses the first body image as the cover source
- Same inputs produce the same request payloads

## Failure Rules

- Missing `appId` / `appSecret`: fail immediately
- Missing HTML file: fail immediately
- Missing both `thumbImagePath` and any body image: fail immediately
- Invalid content image type or size in strict mode: fail immediately
- WeChat API error: surface the exact operation and error message

## Validation

Run this when you need a local dry-run verification:

```bash
pnpm --dir ~/.codex/skills/wechat-mp-draft-publisher run verify
```
