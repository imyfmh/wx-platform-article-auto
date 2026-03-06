import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import juice from 'juice'
import { DOMParser } from 'linkedom'
import { marked } from 'marked'
import { parse as parseYaml } from 'yaml'

import { initRenderer } from '../../vendor/packages/core/src/renderer/renderer-impl.ts'
import { postProcessHtml, renderMarkdown } from '../../vendor/packages/core/src/utils/markdownHelpers.ts'
import { customizeTheme } from '../../vendor/packages/core/src/utils/themeHelpers.ts'
import { defaultStyleConfig } from '../../vendor/packages/shared/src/configs/style.ts'
import { themeMap } from '../../vendor/packages/shared/src/configs/theme.ts'

export interface WechatRenderConfig {
  theme: keyof typeof themeMap
  primaryColor: string
  fonts: string
  fontSize: string
  useIndent: boolean
  useJustify: boolean
  showFootnotes: boolean
  showReadingTime: boolean
  showLineNumbers: boolean
  macCodeBlock: boolean
  legend: string
  codeBlockTheme: string
  debugOutput: boolean
  strict: boolean
}

export interface WechatRenderResult {
  intermediateHtml: string
  finalHtml: string
}

const DEFAULT_CONFIG: WechatRenderConfig = {
  theme: defaultStyleConfig.theme,
  primaryColor: defaultStyleConfig.primaryColor,
  fonts: defaultStyleConfig.fontFamily,
  fontSize: defaultStyleConfig.fontSize,
  useIndent: false,
  useJustify: false,
  showFootnotes: defaultStyleConfig.isCiteStatus,
  showReadingTime: defaultStyleConfig.isCountStatus,
  showLineNumbers: defaultStyleConfig.isShowLineNumber,
  macCodeBlock: defaultStyleConfig.isMacCodeBlock,
  legend: defaultStyleConfig.legend,
  codeBlockTheme: `github`,
  debugOutput: false,
  strict: true,
}

const SUPPORTED_THEMES = new Set(Object.keys(themeMap))
const UNSUPPORTED_FENCE_LANGS = new Set([`mermaid`, `plantuml`])

export function parseCliArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: `string`, short: `i` },
      output: { type: `string`, short: `o` },
      config: { type: `string`, short: `c` },
      debug: { type: `boolean` },
      strict: { type: `boolean` },
    },
    allowPositionals: false,
  })

  if (!values.input) {
    throw new Error(`Missing required --input <markdown-file>`)
  }

  return values
}

export async function loadConfig(configPath?: string): Promise<WechatRenderConfig> {
  if (!configPath) {
    return { ...DEFAULT_CONFIG }
  }

  const raw = await readFile(configPath, `utf8`)
  const parsed = parseYaml(raw)
  if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
    throw new Error(`Config file must parse to an object: ${configPath}`)
  }

  const config = { ...DEFAULT_CONFIG, ...parsed } as WechatRenderConfig
  validateConfig(config, configPath)
  return config
}

export function validateConfig(config: WechatRenderConfig, configPath = `config`) {
  if (!SUPPORTED_THEMES.has(config.theme)) {
    throw new Error(`Unsupported theme "${config.theme}" in ${configPath}`)
  }

  const requiredStringKeys: (keyof WechatRenderConfig)[] = [
    `primaryColor`,
    `fonts`,
    `fontSize`,
    `legend`,
    `codeBlockTheme`,
  ]

  for (const key of requiredStringKeys) {
    if (typeof config[key] !== `string` || !String(config[key]).trim()) {
      throw new Error(`Invalid ${key} in ${configPath}`)
    }
  }
}

export async function renderWechatHtml(markdown: string, config: WechatRenderConfig): Promise<WechatRenderResult> {
  if (config.strict) {
    validateMarkdown(markdown)
  }

  const theme = customizeTheme(themeMap[config.theme], {
    color: config.primaryColor,
  })

  const renderer = initRenderer({
    theme,
    fonts: config.fonts,
    size: config.fontSize,
    isUseIndent: config.useIndent,
    isUseJustify: config.useJustify,
    legend: config.legend,
    citeStatus: config.showFootnotes,
    countStatus: config.showReadingTime,
    isMacCodeBlock: config.macCodeBlock,
    isShowLineNumber: config.showLineNumbers,
  })

  const { html, readingTime } = renderMarkdown(markdown, renderer)
  const intermediateFragment = postProcessHtml(html, readingTime, renderer)
  const finalFragment = await finalizeWechatHtml(intermediateFragment, config)

  return {
    intermediateHtml: wrapHtmlDocument(intermediateFragment),
    finalHtml: wrapHtmlDocument(finalFragment),
  }
}

export async function renderWechatFile(inputPath: string, outputPath: string, config: WechatRenderConfig) {
  const markdown = await readFile(inputPath, `utf8`)
  const result = await renderWechatHtml(markdown, config)

  await writeFile(outputPath, result.finalHtml, `utf8`)

  let debugPath: string | undefined
  if (config.debugOutput) {
    const parsed = path.parse(outputPath)
    debugPath = path.join(parsed.dir, `${parsed.name}.intermediate${parsed.ext || `.html`}`)
    await writeFile(debugPath, result.intermediateHtml, `utf8`)
  }

  return {
    outputPath,
    debugPath,
  }
}

export async function loadHighlightCss(themeName: string): Promise<string> {
  const cssUrl = themeName.endsWith(`.css`) ? themeName : await import.meta.resolve(`highlight.js/styles/${themeName}.css`)
  const cssPath = cssUrl.startsWith(`file:`) ? new URL(cssUrl) : cssUrl
  return readFile(cssPath, `utf8`)
}

function validateMarkdown(markdown: string) {
  const tokens = marked.lexer(markdown, { gfm: true })
  walkTokens(tokens)
}

function walkTokens(tokens: any[], parents: string[] = []) {
  for (const token of tokens) {
    const location = [...parents, token.type].join(` > `)

    if (token.type === `html`) {
      throw new Error(`Unsupported raw HTML block detected at ${location}: ${truncate(token.raw)}`)
    }

    if (token.type === `code`) {
      const lang = String(token.lang || ``).trim().toLowerCase()
      if (UNSUPPORTED_FENCE_LANGS.has(lang)) {
        throw new Error(`Unsupported fenced code language "${lang}" detected at ${location}`)
      }
    }

    if (Array.isArray(token.tokens)) {
      walkTokens(token.tokens, [...parents, token.type])
    }

    if (Array.isArray(token.items)) {
      for (const [index, item] of token.items.entries()) {
        if (Array.isArray(item.tokens)) {
          walkTokens(item.tokens, [...parents, `${token.type}[${index}]`])
        }
      }
    }
  }
}

async function finalizeWechatHtml(intermediateHtml: string, config: WechatRenderConfig) {
  const hljsCss = await loadHighlightCss(config.codeBlockTheme)
  const mergedHtml = juice(`<style>${hljsCss}</style>${intermediateHtml}`, {
    inlinePseudoElements: true,
    preserveImportant: true,
  })
  const mergedFragment = extractBodyFragment(mergedHtml)
  const normalizedFragment = normalizeWechatHtml(modifyHtmlStructure(mergedFragment), config.primaryColor)
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${normalizedFragment}</body></html>`, `text/html`)

  solveWeChatImage(doc.body)
  addSvgSpacerNodes(doc.body, doc)
  normalizeMermaidLabels(doc.body, doc)

  return doc.body.innerHTML
}

function extractBodyFragment(html: string) {
  const doc = new DOMParser().parseFromString(html, `text/html`)
  return doc.body?.innerHTML || html
}

function modifyHtmlStructure(html: string) {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, `text/html`)
  doc.querySelectorAll(`li > ul, li > ol`).forEach((nestedList) => {
    nestedList.parentElement?.insertAdjacentElement(`afterend`, nestedList)
  })
  return doc.body.innerHTML
}

function normalizeWechatHtml(html: string, primaryColor: string) {
  return html
    .replace(/([^-])top:(.*?)em/g, `$1transform: translateY($2em)`)
    .replace(/hsl\(var\(--foreground\)\)/g, `#3f3f3f`)
    .replace(/var\(--blockquote-background\)/g, `#f7f7f7`)
    .replace(/var\(--md-primary-color\)/g, primaryColor)
    .replace(/--md-primary-color:.+?;/g, ``)
    .replace(
      /<span class="nodeLabel"([^>]*)><p[^>]*>(.*?)<\/p><\/span>/g,
      `<span class="nodeLabel"$1>$2</span>`,
    )
    .replace(
      /<span class="edgeLabel"([^>]*)><p[^>]*>(.*?)<\/p><\/span>/g,
      `<span class="edgeLabel"$1>$2</span>`,
    )
}

function solveWeChatImage(root: HTMLElement) {
  root.querySelectorAll(`img`).forEach((image) => {
    const width = image.getAttribute(`width`)
    const height = image.getAttribute(`height`)

    if (width) {
      image.removeAttribute(`width`)
      image.setAttribute(`style`, appendStyle(image.getAttribute(`style`), `width: ${width};`))
    }
    if (height) {
      image.removeAttribute(`height`)
      image.setAttribute(`style`, appendStyle(image.getAttribute(`style`), `height: ${height};`))
    }
  })
}

function addSvgSpacerNodes(root: HTMLElement, document: Document) {
  root.insertBefore(createEmptyNode(document), root.firstChild)
  root.appendChild(createEmptyNode(document))
}

function createEmptyNode(document: Document) {
  const node = document.createElement(`p`)
  node.setAttribute(`style`, `font-size:0;line-height:0;margin:0;`)
  node.innerHTML = `&nbsp;`
  return node
}

function normalizeMermaidLabels(root: HTMLElement, document: Document) {
  root.querySelectorAll(`.nodeLabel`).forEach((node) => {
    const parent = node.parentElement
    const grandParent = parent?.parentElement
    if (!parent || !grandParent) {
      return
    }

    const section = document.createElement(`section`)
    const xmlns = parent.getAttribute(`xmlns`)
    const style = parent.getAttribute(`style`)
    if (xmlns) {
      section.setAttribute(`xmlns`, xmlns)
    }
    if (style) {
      section.setAttribute(`style`, style)
    }
    section.innerHTML = parent.innerHTML
    grandParent.innerHTML = ``
    grandParent.appendChild(section)
  })
}

function appendStyle(existing: string | null, next: string) {
  return `${existing || ``}${existing ? ` ` : ``}${next}`.trim()
}

function truncate(raw: string, length = 80) {
  const text = raw.replace(/\s+/g, ` `).trim()
  return text.length > length ? `${text.slice(0, length)}...` : text
}

function wrapHtmlDocument(fragment: string) {
  return [
    `<!DOCTYPE html>`,
    `<html lang="zh-CN">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>wechat-html</title>`,
    `</head>`,
    `<body>`,
    fragment,
    `</body>`,
    `</html>`,
    ``,
  ].join(`\n`)
}
