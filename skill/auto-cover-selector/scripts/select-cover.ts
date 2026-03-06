import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

interface AutoCoverCliArgs {
  title?: string
  digest?: string
  markdown?: string
  output?: string
  credentials?: string
  'pexels-api-base'?: string
  'pixabay-api-base'?: string
}

interface AutoCoverSelectionOptions {
  title: string
  digest?: string
  markdownPath?: string
  outputPath?: string
  credentialsPath?: string
  pexelsApiBase?: string
  pixabayApiBase?: string
}

interface AutoCoverSelectionResult {
  coverPath: string
  provider: `pexels` | `pixabay`
  query: string
  sourceUrl: string
}

interface CoverApiCredentials {
  pexelsApiKey?: string
  pixabayApiKey?: string
}

interface CoverCandidate {
  provider: `pexels` | `pixabay`
  query: string
  imageUrl: string
  sourceUrl: string
  filenameBase: string
  width: number
  height: number
  score: number
}

const DEFAULT_CREDENTIALS_PATH = `~/.pw`
const DEFAULT_PEXELS_API_BASE = `https://api.pexels.com/v1`
const DEFAULT_PIXABAY_API_BASE = `https://pixabay.com/api`
const MAX_CANDIDATES_PER_QUERY = 6
const MIN_PIXABAY_PER_PAGE = 3
const MAX_TOTAL_QUERIES = 6

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  if (!args.title && !args.markdown) {
    throw new Error(`Provide --title or --markdown`)
  }

  const result = await selectCoverImage({
    title: args.title || path.parse(args.markdown || `article`).name,
    digest: args.digest,
    markdownPath: args.markdown,
    outputPath: args.output,
    credentialsPath: args.credentials,
    pexelsApiBase: args[`pexels-api-base`],
    pixabayApiBase: args[`pixabay-api-base`],
  })

  console.log(`Selected cover image:`)
  console.log(`- cover: ${result.coverPath}`)
  console.log(`- provider: ${result.provider}`)
  console.log(`- query: ${result.query}`)
  console.log(`- source: ${result.sourceUrl}`)
}

export async function selectCoverImage(options: AutoCoverSelectionOptions): Promise<AutoCoverSelectionResult> {
  const credentialsPath = expandHomePath(options.credentialsPath || DEFAULT_CREDENTIALS_PATH)
  const credentials = await loadCoverApiCredentials(credentialsPath)
  const markdown = options.markdownPath ? await readFile(path.resolve(options.markdownPath), `utf8`) : ``
  const title = cleanText(options.title)
  const digest = cleanText(options.digest || ``)
  const queries = buildQueries(title, digest, markdown)

  if (!queries.length) {
    throw new Error(`Unable to derive cover-image search queries`)
  }

  const candidates: CoverCandidate[] = []
  for (const [index, query] of queries.entries()) {
    const perQueryCandidates = await searchCandidates(query, index, credentials, {
      pexelsApiBase: options.pexelsApiBase || DEFAULT_PEXELS_API_BASE,
      pixabayApiBase: options.pixabayApiBase || DEFAULT_PIXABAY_API_BASE,
    })
    candidates.push(...perQueryCandidates)
  }

  if (!candidates.length) {
    throw new Error(`No cover candidates found from Pexels or Pixabay`)
  }

  candidates.sort((left, right) => right.score - left.score)
  const chosen = candidates[0]
  const image = await downloadImage(chosen.imageUrl)
  const outputPath = resolveOutputPath(options.outputPath, chosen, image.mimeType)

  await writeFile(outputPath, image.buffer)
  return {
    coverPath: outputPath,
    provider: chosen.provider,
    query: chosen.query,
    sourceUrl: chosen.sourceUrl,
  }
}

function parseCliArgs(argv: string[]): AutoCoverCliArgs {
  const normalizedArgv = argv[0] === `--` ? argv.slice(1) : argv
  const { values } = parseArgs({
    args: normalizedArgv,
    options: {
      title: { type: `string`, short: `t` },
      digest: { type: `string`, short: `d` },
      markdown: { type: `string`, short: `m` },
      output: { type: `string`, short: `o` },
      credentials: { type: `string`, short: `c` },
      'pexels-api-base': { type: `string` },
      'pixabay-api-base': { type: `string` },
    },
    allowPositionals: false,
  })

  return {
    title: values.title,
    digest: values.digest,
    markdown: values.markdown,
    output: values.output,
    credentials: values.credentials,
    'pexels-api-base': values[`pexels-api-base`],
    'pixabay-api-base': values[`pixabay-api-base`],
  }
}

async function searchCandidates(
  query: string,
  queryIndex: number,
  credentials: CoverApiCredentials,
  apiBases: { pexelsApiBase: string, pixabayApiBase: string },
) {
  const candidates: CoverCandidate[] = []
  const errors: string[] = []

  if (credentials.pexelsApiKey) {
    try {
      const pexels = await searchPexels(query, queryIndex, credentials.pexelsApiKey, apiBases.pexelsApiBase)
      candidates.push(...pexels)
    }
    catch (error) {
      errors.push(`Pexels: ${formatError(error)}`)
    }
  }

  if (credentials.pixabayApiKey) {
    try {
      const pixabay = await searchPixabay(query, queryIndex, credentials.pixabayApiKey, apiBases.pixabayApiBase)
      candidates.push(...pixabay)
    }
    catch (error) {
      errors.push(`Pixabay: ${formatError(error)}`)
    }
  }

  if (!candidates.length && errors.length) {
    throw new Error(errors.join(`; `))
  }

  return candidates
}

async function searchPexels(query: string, queryIndex: number, apiKey: string, apiBase: string) {
  const url = new URL(`${apiBase.replace(/\/+$/, ``)}/search`)
  url.searchParams.set(`query`, query)
  url.searchParams.set(`per_page`, String(MAX_CANDIDATES_PER_QUERY))
  url.searchParams.set(`orientation`, `landscape`)
  url.searchParams.set(`size`, `large`)

  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  })
  if (!response.ok) {
    throw new Error(`Pexels search failed with HTTP ${response.status}`)
  }

  const data = await response.json() as { photos?: Array<any> }
  return (data.photos || [])
    .map((photo) => {
      const imageUrl = readFirstString(photo?.src?.landscape, photo?.src?.large2x, photo?.src?.large, photo?.src?.original)
      if (!imageUrl) {
        return undefined
      }

      const width = Number(photo.width || 0)
      const height = Number(photo.height || 0)
      return {
        provider: `pexels` as const,
        query,
        imageUrl,
        sourceUrl: String(photo.url || imageUrl),
        filenameBase: `pexels-${photo.id || `cover`}`,
        width,
        height,
        score: scoreCandidate({
          provider: `pexels`,
          queryIndex,
          width,
          height,
        }),
      }
    })
    .filter(Boolean) as CoverCandidate[]
}

async function searchPixabay(query: string, queryIndex: number, apiKey: string, apiBase: string) {
  const url = new URL(apiBase)
  url.searchParams.set(`key`, apiKey)
  url.searchParams.set(`q`, query)
  url.searchParams.set(`image_type`, `photo`)
  url.searchParams.set(`orientation`, `horizontal`)
  url.searchParams.set(`per_page`, String(pixabayPerPage()))
  url.searchParams.set(`safesearch`, `true`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Pixabay search failed with HTTP ${response.status}`)
  }

  const data = await response.json() as { hits?: Array<any> }
  return (data.hits || [])
    .map((hit) => {
      const imageUrl = readFirstString(hit.largeImageURL, hit.webformatURL, hit.previewURL)
      if (!imageUrl) {
        return undefined
      }

      const width = Number(hit.imageWidth || 0)
      const height = Number(hit.imageHeight || 0)
      return {
        provider: `pixabay` as const,
        query,
        imageUrl,
        sourceUrl: String(hit.pageURL || imageUrl),
        filenameBase: `pixabay-${hit.id || `cover`}`,
        width,
        height,
        score: scoreCandidate({
          provider: `pixabay`,
          queryIndex,
          width,
          height,
        }),
      }
    })
    .filter(Boolean) as CoverCandidate[]
}

function pixabayPerPage() {
  return Math.max(MAX_CANDIDATES_PER_QUERY, MIN_PIXABAY_PER_PAGE)
}

function scoreCandidate(input: {
  provider: `pexels` | `pixabay`
  queryIndex: number
  width: number
  height: number
}) {
  const ratio = input.width > 0 && input.height > 0 ? input.width / input.height : 0
  let score = input.provider === `pexels` ? 100 : 90
  score -= input.queryIndex * 6

  if (input.width >= 1200) {
    score += 12
  }
  if (input.width >= 1600) {
    score += 8
  }
  if (ratio >= 1.45 && ratio <= 2.1) {
    score += 14
  }
  else if (ratio >= 1.2) {
    score += 6
  }

  return score
}

async function downloadImage(sourceUrl: string) {
  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}: ${sourceUrl}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const mimeType = normalizeMimeType(response.headers.get(`content-type`) || inferMimeTypeFromUrl(sourceUrl))
  if (!mimeType.startsWith(`image/`)) {
    throw new Error(`Downloaded cover is not an image: ${sourceUrl}`)
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
  }
}

async function loadCoverApiCredentials(credentialsPath: string): Promise<CoverApiCredentials> {
  const raw = await readFile(credentialsPath, `utf8`)
  const parsed = looksLikeIni(raw) ? parseIniSections(raw) : parseFlatObject(raw, credentialsPath)

  const pexels = parsed.pexels || parsed.Pexels || parsed.PEXELS || {}
  const pixabay = parsed.pixabay || parsed.Pixabay || parsed.PIXABAY || {}

  const credentials: CoverApiCredentials = {
    pexelsApiKey: readOptionalApiKey(pexels.apiKey ?? pexels.apikey ?? pexels.key),
    pixabayApiKey: readOptionalApiKey(pixabay.apiKey ?? pixabay.apikey ?? pixabay.key),
  }

  if (!credentials.pexelsApiKey && !credentials.pixabayApiKey) {
    throw new Error(`Missing [pexels] apiKey and [pixabay] apiKey in ${credentialsPath}`)
  }

  return credentials
}

function buildQueries(title: string, digest: string, markdown: string) {
  const baseText = [title, digest, extractKeywordsFromMarkdown(markdown)].filter(Boolean).join(` `)
  const latinTerms = Array.from(new Set((baseText.match(/[A-Za-z][A-Za-z0-9+-]{2,}/g) || []).map((term) => term.toLowerCase())))
  const queries: string[] = []

  pushQuery(queries, normalizeQuery(title))
  pushQuery(queries, normalizeQuery([title, digest].filter(Boolean).join(` `)))

  if (/openclaw/i.test(baseText)) {
    pushQuery(queries, `ai agent automation`)
    pushQuery(queries, `future technology workspace`)
  }
  if (/(验证码|风控|安全|攻防|robot|captcha)/i.test(baseText)) {
    pushQuery(queries, `cybersecurity technology`)
    pushQuery(queries, `digital security abstract`)
  }
  if (/(ai|人工智能|智能体|agent|模型|automation|自动化)/i.test(baseText)) {
    pushQuery(queries, `artificial intelligence technology`)
    pushQuery(queries, `ai agent workspace`)
  }
  if (latinTerms.length) {
    pushQuery(queries, latinTerms.slice(0, 4).join(` `))
  }

  return queries.slice(0, MAX_TOTAL_QUERIES)
}

function pushQuery(queries: string[], query: string) {
  const normalized = normalizeQuery(query)
  if (!normalized || queries.includes(normalized)) {
    return
  }
  queries.push(normalized)
}

function normalizeQuery(value: string) {
  return value
    .replace(/[，。！？：；、“”"'‘’（）()]/g, ` `)
    .replace(/\s+/g, ` `)
    .trim()
}

function extractKeywordsFromMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ` `)
    .replace(/!\[.*?\]\(.*?\)/g, ` `)
    .replace(/[#>*`\-]/g, ` `)
    .replace(/\s+/g, ` `)
    .trim()
    .slice(0, 400)
}

function readFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === `string` && value.trim()) {
      return value.trim()
    }
  }
  return ``
}

function resolveOutputPath(outputPath: string | undefined, chosen: CoverCandidate, mimeType: string) {
  const ext = extensionFromMimeType(mimeType) || `.jpg`
  if (outputPath) {
    const resolved = path.resolve(outputPath)
    const currentExt = path.extname(resolved).toLowerCase()
    if (!currentExt) {
      return `${resolved}${ext}`
    }
    if (currentExt === `.jpg` || currentExt === `.jpeg` || currentExt === `.png` || currentExt === `.webp`) {
      return resolved
    }
    return `${resolved}${ext}`
  }
  return path.resolve(process.cwd(), `${chosen.filenameBase}${ext}`)
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ` `).trim()
}

function expandHomePath(inputPath: string) {
  if (inputPath === `~`) {
    return process.env.HOME || inputPath
  }
  if (inputPath.startsWith(`~/`)) {
    return path.join(process.env.HOME || `~`, inputPath.slice(2))
  }
  return path.resolve(inputPath)
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(`;`)[0].trim().toLowerCase()
}

function inferMimeTypeFromUrl(sourceUrl: string) {
  const lower = new URL(sourceUrl).pathname.toLowerCase()
  if (lower.endsWith(`.png`)) {
    return `image/png`
  }
  if (lower.endsWith(`.jpg`) || lower.endsWith(`.jpeg`)) {
    return `image/jpeg`
  }
  if (lower.endsWith(`.webp`)) {
    return `image/webp`
  }
  return `application/octet-stream`
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case `image/png`:
      return `.png`
    case `image/jpeg`:
      return `.jpg`
    case `image/webp`:
      return `.webp`
    default:
      return ``
  }
}

function readOptionalApiKey(value: unknown) {
  return typeof value === `string` && value.trim() ? value.trim() : undefined
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function looksLikeIni(raw: string) {
  return /^\s*\[[^\]]+\]/m.test(raw)
}

function parseFlatObject(raw: string, filePath: string) {
  const parsed = filePath.endsWith(`.json`) ? JSON.parse(raw) : parseSimpleYaml(raw, filePath)
  if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
    throw new Error(`Credentials file must parse to an object: ${filePath}`)
  }
  return parsed as Record<string, any>
}

function parseSimpleYaml(raw: string, filePath: string) {
  const result: Record<string, any> = {}
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(`#`)) {
      continue
    }
    const separatorIndex = trimmed.indexOf(`:`)
    if (separatorIndex === -1) {
      throw new Error(`Unsupported YAML line at ${filePath}:${index + 1}`)
    }
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    result[key] = unquote(value)
  }
  return result
}

function parseIniSections(raw: string) {
  const result: Record<string, Record<string, any>> = {}
  let currentSection = ``

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(`#`) || trimmed.startsWith(`;`)) {
      continue
    }
    if (trimmed.startsWith(`[`) && trimmed.endsWith(`]`)) {
      currentSection = trimmed.slice(1, -1).trim()
      result[currentSection] = result[currentSection] || {}
      continue
    }

    const separatorIndex = trimmed.indexOf(`=`)
    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!currentSection) {
      result.root = result.root || {}
      result.root[key] = unquote(value)
      continue
    }
    result[currentSection][key] = unquote(value)
  }

  return result
}

function unquote(value: string) {
  if ((value.startsWith(`"`) && value.endsWith(`"`)) || (value.startsWith(`'`) && value.endsWith(`'`))) {
    return value.slice(1, -1)
  }
  return value
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
