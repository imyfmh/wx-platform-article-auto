# Config

YAML keys supported by the renderer:

- `theme`
- `primaryColor`
- `fonts`
- `fontSize`
- `useIndent`
- `useJustify`
- `showFootnotes`
- `showReadingTime`
- `showLineNumbers`
- `macCodeBlock`
- `legend`
- `codeBlockTheme`
- `debugOutput`
- `strict`

Defaults come from the workspace renderer's default style config and are suitable for direct use when no config file is provided.

`theme` must be one of:

- `default`
- `grace`
- `simple`

## Typical Config

```yaml
theme: default
primaryColor: "#0F4C81"
fonts: "-apple-system-font,BlinkMacSystemFont, Helvetica Neue, PingFang SC, Hiragino Sans GB , Microsoft YaHei UI , Microsoft YaHei ,Arial,sans-serif"
fontSize: "16px"
useIndent: false
useJustify: true
showFootnotes: true
showReadingTime: true
showLineNumbers: false
macCodeBlock: true
legend: "alt"
codeBlockTheme: "github"
debugOutput: true
strict: true
```


This config is consumed by the standalone skill runtime in `~/.codex/skills/wechat-markdown-renderer/scripts/`.
