import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { selectCoverImage } from '../../auto-cover-selector/scripts/select-cover.ts'
import { DEFAULT_CREDENTIALS_PATH, expandHomePath, publishWechatDraft } from '../../wechat-mp-draft-publisher/scripts/wechat-draft-publisher/lib.ts'

interface PipelineCliArgs {
  markdown?: string
  html: string
  credentials?: string
  cover?: string
  author?: string
  title?: string
  digest?: string
  jobOutput?: string
  resultOutput?: string
  apiBase?: string
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  const htmlPath = path.resolve(args.html)
  const markdownPath = args.markdown ? path.resolve(args.markdown) : undefined
  const credentialsPath = expandHomePath(args.credentials || DEFAULT_CREDENTIALS_PATH)
  const jobPath = path.resolve(args.jobOutput || defaultSiblingPath(htmlPath, `.draft-job.yaml`))
  const resultPath = path.resolve(args.resultOutput || defaultSiblingPath(htmlPath, `.draft-result.json`))

  const html = await readFile(htmlPath, `utf8`)
  const markdown = markdownPath ? await readFile(markdownPath, `utf8`) : ``
  const title = args.title || extractTitle(markdown, html)
  const digest = args.digest || extractDigest(markdown, html)

  if (!title) {
    throw new Error(`Unable to derive title from the article; provide --title explicitly`)
  }

  const coverPath = args.cover || await maybeSelectAutoCover({
    title,
    digest,
    markdownPath,
    htmlPath,
    credentialsPath,
  })

  const draftJob = {
    htmlPath,
    title,
    ...(digest ? { digest } : {}),
    ...(args.author ? { author: args.author } : {}),
    ...(coverPath ? { thumbImagePath: coverPath } : {}),
  }

  await writeFile(jobPath, serializeYaml(draftJob), `utf8`)
  const result = await publishWechatDraft({
    credentialsPath,
    jobPath,
    outputPath: resultPath,
    apiBase: args.apiBase,
  })

  console.log(`Built and published WeChat draft:`)
  console.log(`- credentials: ${credentialsPath}`)
  if (markdownPath) {
    console.log(`- markdown: ${markdownPath}`)
  }
  console.log(`- html: ${htmlPath}`)
  console.log(`- title: ${title}`)
  if (digest) {
    console.log(`- digest: ${digest}`)
  }
  if (coverPath) {
    console.log(`- cover: ${coverPath}`)
  }
  console.log(`- draft job: ${jobPath}`)
  console.log(`- result: ${resultPath}`)
  console.log(`- media_id: ${result.mediaId}`)
}

function parseCliArgs(argv: string[]): PipelineCliArgs {
  const normalizedArgv = argv[0] === `--` ? argv.slice(1) : argv
  const { values } = parseArgs({
    args: normalizedArgv,
    options: {
      markdown: { type: `string`, short: `m` },
      html: { type: `string`, short: `h` },
      credentials: { type: `string`, short: `c` },
      cover: { type: `string` },
      author: { type: `string` },
      title: { type: `string` },
      digest: { type: `string` },
      'job-output': { type: `string` },
      'result-output': { type: `string` },
      'api-base': { type: `string` },
    },
    allowPositionals: false,
  })

  if (!values.html) {
    throw new Error(`Missing required --html <wechat-html-file>`)
  }

  return {
    markdown: values.markdown,
    html: values.html,
    credentials: values.credentials,
    cover: values.cover,
    author: values.author,
    title: values.title,
    digest: values.digest,
    jobOutput: values[`job-output`],
    resultOutput: values[`result-output`],
    apiBase: values[`api-base`],
  }
}

function extractTitle(markdown: string, html: string) {
  const markdownMatch = markdown.match(/^#\s+(.+?)\s*$/m)
  if (markdownMatch?.[1]) {
    return cleanInlineText(markdownMatch[1])
  }

  const htmlMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (htmlMatch?.[1]) {
    return cleanInlineText(stripTags(htmlMatch[1]))
  }

  return ``
}

function extractDigest(markdown: string, html: string) {
  const markdownDigest = extractDigestFromMarkdown(markdown)
  if (markdownDigest) {
    return markdownDigest
  }

  const htmlMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
  if (!htmlMatch?.[1]) {
    return ``
  }
  return summarize(stripTags(htmlMatch[1]))
}

function extractDigestFromMarkdown(markdown: string) {
  if (!markdown.trim()) {
    return ``
  }

  const normalized = markdown
    .replace(/```[\s\S]*?```/g, ``)
    .replace(/^#\s+.*$/gm, ``)
    .replace(/<img\b[^>]*>/gi, ``)

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  for (const paragraph of paragraphs) {
    if (/^([>#-]|\d+\.)/.test(paragraph)) {
      continue
    }
    const cleaned = summarize(cleanInlineText(paragraph.replace(/\n+/g, ` `)))
    if (cleaned) {
      return cleaned
    }
  }

  return ``
}

function cleanInlineText(input: string) {
  return input
    .replace(/`([^`]+)`/g, `$1`)
    .replace(/\*\*([^*]+)\*\*/g, `$1`)
    .replace(/\*([^*]+)\*/g, `$1`)
    .replace(/!\[.*?\]\(.*?\)/g, ``)
    .replace(/\[(.*?)\]\(.*?\)/g, `$1`)
    .replace(/<[^>]+>/g, ``)
    .replace(/\s+/g, ` `)
    .trim()
}

function stripTags(input: string) {
  return input
    .replace(/<br\s*\/?>/gi, ` `)
    .replace(/<[^>]+>/g, ` `)
    .replace(/&nbsp;/g, ` `)
    .replace(/&quot;/g, `"`)
    .replace(/&amp;/g, `&`)
    .replace(/&lt;/g, `<`)
    .replace(/&gt;/g, `>`)
}

function summarize(input: string) {
  const text = input.replace(/\s+/g, ` `).trim()
  if (!text) {
    return ``
  }
  return text.length <= 120 ? text : `${text.slice(0, 117).trim()}...`
}

function serializeYaml(data: Record<string, string>) {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${quoteYaml(value)}`)
  return `${lines.join(`\n`)}\n`
}

function quoteYaml(value: string) {
  if (!value) {
    return `""`
  }
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value
  }
  return JSON.stringify(value)
}

function defaultSiblingPath(htmlPath: string, suffix: string) {
  const parsed = path.parse(htmlPath)
  return path.join(parsed.dir, `${parsed.name}${suffix}`)
}

async function maybeSelectAutoCover(input: {
  title: string
  digest: string
  markdownPath?: string
  htmlPath: string
  credentialsPath: string
}) {
  try {
    const outputStem = defaultSiblingPath(input.htmlPath, `.cover`)
    const result = await selectCoverImage({
      title: input.title,
      digest: input.digest,
      markdownPath: input.markdownPath,
      outputPath: outputStem,
      credentialsPath: input.credentialsPath,
    })
    return result.coverPath
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Auto cover selection skipped: ${message}`)
    return ``
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
