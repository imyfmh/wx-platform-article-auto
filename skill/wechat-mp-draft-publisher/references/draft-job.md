# Draft Job File

Use YAML or JSON.

Required keys:

- `htmlPath`: absolute path or path relative to the job file
- `title`

Optional keys:

- `thumbImagePath`: local path, `file://` path, `http(s)` URL, or `data:` URL
- `digest`
- `author`
- `contentSourceUrl`
- `needOpenComment`: `0` or `1`
- `onlyFansCanComment`: `0` or `1`
- `thumbMaterialType`: `image` or `thumb`
- `strictImages`: boolean, defaults to `true`

Rules:

- `htmlPath` must already point to WeChat-compatible HTML.
- If `thumbImagePath` is omitted, the publisher uses the first `<img>` in the HTML as the cover source.
- Body images that are not already hosted on WeChat will be uploaded with `media/uploadimg`.
- In strict mode, body images must be `jpg/jpeg/png` and <= `1MB`.
- Cover image must be an image and <= `10MB`.

YAML example:

```yaml
htmlPath: /abs/path/article.wechat.html
title: 示例标题
digest: 示例摘要
author: 示例作者
contentSourceUrl: https://example.com/original-article
needOpenComment: 0
onlyFansCanComment: 0
thumbMaterialType: image
strictImages: true
```

Explicit cover example:

```yaml
htmlPath: /abs/path/article.wechat.html
title: 示例标题
thumbImagePath: /abs/path/cover.png
```
