---
name: wechat-markdown-renderer
description: Convert a Markdown file into deterministic WeChat article HTML with optional YAML config and strict unsupported-syntax checks. Use when the user wants Markdown 转微信公众号 HTML、公众号正文格式转换、or a reusable markdown-to-wechat-html automation step.
---

# WeChat Markdown Renderer

Use this skill when the task is: `markdown file -> WeChat-compatible HTML`.

This skill is standalone and carries its own renderer runtime under the skill directory, so it can work across workspaces even if the original repository is deleted.

## Workflow

1. Collect:
   - Markdown file path
   - Optional YAML config path
2. If no config file is provided, use the default renderer config.
3. Run the standalone renderer script from the installed skill directory:

```bash
node --experimental-strip-types ~/.codex/skills/wechat-markdown-renderer/scripts/render-wechat-html.ts --input /abs/path/input.md --config /abs/path/config.yaml --output /abs/path/output.html
```

4. Return:
   - final HTML path
   - optional intermediate HTML path if debug output is enabled
5. If the user asks for validation, run:

```bash
node --experimental-strip-types ~/.codex/skills/wechat-markdown-renderer/scripts/verify-wechat-renderer.ts
```

## Chaining

- Use this after article-writing skills such as `$article-assistant`, `$article-draft`, or `$article-polish`.
- Preferred sequence:
  1. Write or polish Markdown
  2. Save Markdown to file
  3. Invoke `$wechat-markdown-renderer`
  4. Pass the resulting HTML to later publishing automation

## Output Contract

- Final output: deterministic WeChat-ready HTML document
- Optional debug output: `.intermediate.html`
- Same input file plus same config must produce the same output

## Behavior

- Input is deterministic: one Markdown file plus optional YAML config
- Output is deterministic: one final HTML file and optional intermediate HTML
- Unsupported syntax fails fast in strict mode
- Raw HTML blocks are rejected
- `mermaid` and `plantuml` fenced blocks are rejected in v1 strict mode
- The script runs without browser page state, manual clicks, or clipboard operations

## Authoring Notes

- Use standard Markdown image syntax such as `![alt](url-or-path)` for article images
- Do not embed standalone raw HTML image blocks like `<img ... />`; strict mode rejects them before rendering

## Config

Read `references/config.md` when you need the supported config keys and defaults.
