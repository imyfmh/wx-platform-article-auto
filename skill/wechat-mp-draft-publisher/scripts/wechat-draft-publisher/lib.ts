import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export interface WechatCredentials {
  appId: string
  appSecret: string
  forceRefresh?: boolean
}

export interface DraftJobConfig {
  htmlPath: string
  title: string
  digest?: string
  author?: string
  thumbImagePath?: string
  contentSourceUrl?: string
  needOpenComment?: 0 | 1
  onlyFansCanComment?: 0 | 1
  thumbMaterialType?: `image` | `thumb`
  strictImages?: boolean
}

export interface PublishCliArgs {
  credentials?: string
  job: string
  output?: string
  apiBase?: string
}

export interface PublishWechatDraftOptions {
  credentialsPath: string
  jobPath: string
  outputPath?: string
  apiBase?: string
}

export interface PublishWechatDraftResult {
  mediaId: string
  thumbMediaId: string
  uploadedContentImageCount: number
  outputPath?: string
}

interface UploadableFile {
  buffer: Buffer
  mimeType: string
  filename: string
  sourceLabel: string
}

const DEFAULT_API_BASE = `https://api.weixin.qq.com/cgi-bin`
export const DEFAULT_CREDENTIALS_PATH = `~/.pw`
const MAX_COVER_SIZE = 10 * 1024 * 1024
const MAX_CONTENT_IMAGE_SIZE = 1024 * 1024
const SUPPORTED_CONTENT_IMAGE_MIME_TYPES = new Set([`image/jpeg`, `image/png`])

export function parseCliArgs(argv: string[]): PublishCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      credentials: { type: `string`, short: `c` },
      job: { type: `string`, short: `j` },
      output: { type: `string`, short: `o` },
      'api-base': { type: `string` },
    },
    allowPositionals: false,
  })

  if (!values.job) {
    throw new Error(`Missing required --job <draft-job.yaml>`)
  }

  return {
    credentials: values.credentials,
    job: values.job,
    output: values.output,
    apiBase: values[`api-base`],
  }
}

export async function publishWechatDraft(options: PublishWechatDraftOptions): Promise<PublishWechatDraftResult> {
  const credentialsPath = expandHomePath(options.credentialsPath)
  const jobPath = path.resolve(options.jobPath)
  const apiBase = normalizeApiBase(options.apiBase || DEFAULT_API_BASE)

  const credentials = await loadCredentials(credentialsPath)
  const job = await loadDraftJob(jobPath)
  const htmlPath = resolveExistingPath(job.htmlPath, [
    path.dirname(jobPath),
    process.cwd(),
  ])

  const rawHtml = await readFile(htmlPath, `utf8`)
  const accessToken = await getAccessToken(apiBase, credentials)
  const inferredThumbSource = job.thumbImagePath || extractFirstImageSource(rawHtml)
  if (!inferredThumbSource) {
    throw new Error(`Missing cover source: provide thumbImagePath or ensure the HTML contains at least one <img>`)
  }

  const thumbFile = await loadUploadableFile(inferredThumbSource, [
    path.dirname(jobPath),
    path.dirname(htmlPath),
    process.cwd(),
  ])

  validateCoverFile(thumbFile)
  const thumbMediaId = await uploadMaterial(apiBase, accessToken, thumbFile, job.thumbMaterialType || `image`)
  const { html, uploadedCount } = await processContentImages(apiBase, accessToken, rawHtml, path.dirname(htmlPath), job.strictImages ?? true)
  const mediaId = await addDraft(apiBase, accessToken, {
    title: job.title,
    author: job.author || ``,
    digest: job.digest || ``,
    content: html,
    contentSourceUrl: job.contentSourceUrl,
    thumbMediaId,
    needOpenComment: job.needOpenComment ?? 0,
    onlyFansCanComment: job.onlyFansCanComment ?? 0,
  })

  const result: PublishWechatDraftResult = {
    mediaId,
    thumbMediaId,
    uploadedContentImageCount: uploadedCount,
  }

  if (options.outputPath) {
    const outputPath = path.resolve(options.outputPath)
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, `utf8`)
    result.outputPath = outputPath
  }

  return result
}

export async function loadCredentials(credentialsPath: string): Promise<WechatCredentials> {
  const raw = await readCredentialsFile(credentialsPath)
  const appId = readString(raw.appId ?? raw.appid, `appId`, credentialsPath)
  const appSecret = readString(raw.appSecret ?? raw.secret ?? raw.appsecret, `appSecret`, credentialsPath)
  const forceRefresh = typeof raw.forceRefresh === `boolean`
    ? raw.forceRefresh
    : typeof raw.force_refresh === `boolean`
      ? raw.force_refresh
      : false

  return {
    appId,
    appSecret,
    forceRefresh,
  }
}

export async function loadDraftJob(jobPath: string): Promise<DraftJobConfig> {
  const raw = await readStructuredFile(jobPath)
  const job: DraftJobConfig = {
    htmlPath: readString(raw.htmlPath, `htmlPath`, jobPath),
    title: readString(raw.title, `title`, jobPath),
    thumbImagePath: readOptionalString(raw.thumbImagePath, `thumbImagePath`, jobPath),
    digest: readOptionalString(raw.digest, `digest`, jobPath),
    author: readOptionalString(raw.author, `author`, jobPath),
    contentSourceUrl: readOptionalString(raw.contentSourceUrl ?? raw.content_source_url, `contentSourceUrl`, jobPath),
    needOpenComment: readBinaryFlag(raw.needOpenComment ?? raw.need_open_comment, `needOpenComment`, jobPath),
    onlyFansCanComment: readBinaryFlag(raw.onlyFansCanComment ?? raw.only_fans_can_comment, `onlyFansCanComment`, jobPath),
    thumbMaterialType: readThumbMaterialType(raw.thumbMaterialType ?? raw.thumb_material_type, jobPath),
    strictImages: readOptionalBoolean(raw.strictImages ?? raw.strict_images, `strictImages`, jobPath),
  }

  return job
}

async function getAccessToken(apiBase: string, credentials: WechatCredentials) {
  const response = await fetch(`${apiBase}/stable_token`, {
    method: `POST`,
    headers: {
      'Content-Type': `application/json`,
    },
    body: JSON.stringify({
      grant_type: `client_credential`,
      appid: credentials.appId,
      secret: credentials.appSecret,
      force_refresh: credentials.forceRefresh ?? false,
    }),
  })

  const data = await readWechatJson(response, `stable_token`)
  return readString(data.access_token, `access_token`, `stable_token response`)
}

async function uploadMaterial(apiBase: string, accessToken: string, file: UploadableFile, materialType: `image` | `thumb`) {
  const formData = new FormData()
  formData.set(`media`, new File([file.buffer], file.filename, { type: file.mimeType }))

  const response = await fetch(`${apiBase}/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=${materialType}`, {
    method: `POST`,
    body: formData,
  })

  const data = await readWechatJson(response, `material/add_material`)
  return readString(data.media_id, `media_id`, `material/add_material response`)
}

async function uploadContentImage(apiBase: string, accessToken: string, file: UploadableFile) {
  const formData = new FormData()
  formData.set(`media`, new File([file.buffer], file.filename, { type: file.mimeType }))

  const response = await fetch(`${apiBase}/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`, {
    method: `POST`,
    body: formData,
  })

  const data = await readWechatJson(response, `media/uploadimg`)
  return readString(data.url, `url`, `media/uploadimg response`)
}

async function addDraft(apiBase: string, accessToken: string, article: {
  title: string
  author: string
  digest: string
  content: string
  contentSourceUrl?: string
  thumbMediaId: string
  needOpenComment: 0 | 1
  onlyFansCanComment: 0 | 1
}) {
  const response = await fetch(`${apiBase}/draft/add?access_token=${encodeURIComponent(accessToken)}`, {
    method: `POST`,
    headers: {
      'Content-Type': `application/json`,
    },
    body: JSON.stringify({
      articles: [
        {
          title: article.title,
          author: article.author,
          digest: article.digest,
          content: article.content,
          content_source_url: article.contentSourceUrl,
          thumb_media_id: article.thumbMediaId,
          need_open_comment: article.needOpenComment,
          only_fans_can_comment: article.onlyFansCanComment,
        },
      ],
    }),
  })

  const data = await readWechatJson(response, `draft/add`)
  return readString(data.media_id, `media_id`, `draft/add response`)
}

async function processContentImages(apiBase: string, accessToken: string, html: string, htmlDir: string, strict: boolean) {
  let uploadedCount = 0
  const matches = Array.from(html.matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi))
  let rewrittenHtml = html

  for (const match of matches) {
    const fullTag = match[0]
    const src = match[2]?.trim()
    if (!src || isWechatHostedUrl(src)) {
      continue
    }

    try {
      const file = await loadUploadableFile(src, [htmlDir, process.cwd()])
      validateContentImage(file)
      const wechatUrl = await uploadContentImage(apiBase, accessToken, file)
      rewrittenHtml = rewrittenHtml.replace(fullTag, replaceImageSrc(fullTag, wechatUrl))
      uploadedCount += 1
    }
    catch (error) {
      if (strict) {
        throw new Error(`Failed to process content image "${src}": ${formatError(error)}`)
      }
    }
  }

  return {
    html: rewrittenHtml,
    uploadedCount,
  }
}

async function loadUploadableFile(source: string, searchDirs: string[]): Promise<UploadableFile> {
  if (source.startsWith(`data:`)) {
    return parseDataUrl(source)
  }

  if (source.startsWith(`http://`) || source.startsWith(`https://`)) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const mimeType = normalizeMimeType(response.headers.get(`content-type`) || inferMimeType(source))
    const filename = normalizeFilenameForMimeType(filenameFromSource(source), mimeType)
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
      filename,
      sourceLabel: source,
    }
  }

  const resolvedPath = source.startsWith(`file:`)
    ? fileURLToPath(source)
    : resolveExistingPath(source, searchDirs)
  const buffer = await readFile(resolvedPath)

  return {
    buffer,
    mimeType: normalizeMimeType(inferMimeType(resolvedPath)),
    filename: path.basename(resolvedPath),
    sourceLabel: resolvedPath,
  }
}

function validateCoverFile(file: UploadableFile) {
  if (!file.mimeType.startsWith(`image/`)) {
    throw new Error(`Cover image must be an image file: ${file.sourceLabel}`)
  }
  if (file.buffer.byteLength > MAX_COVER_SIZE) {
    throw new Error(`Cover image exceeds 10MB: ${file.sourceLabel}`)
  }
}

function validateContentImage(file: UploadableFile) {
  if (!SUPPORTED_CONTENT_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new Error(`Content image must be JPEG or PNG: ${file.sourceLabel}`)
  }
  if (file.buffer.byteLength > MAX_CONTENT_IMAGE_SIZE) {
    throw new Error(`Content image exceeds 1MB: ${file.sourceLabel}`)
  }
}

async function readStructuredFile(filePath: string): Promise<Record<string, any>> {
  const raw = await readFile(filePath, `utf8`)
  const parsed = filePath.endsWith(`.json`) ? JSON.parse(raw) : parseSimpleYaml(raw, filePath)
  if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
    throw new Error(`Structured file must parse to an object: ${filePath}`)
  }
  return parsed as Record<string, any>
}

async function readCredentialsFile(filePath: string): Promise<Record<string, any>> {
  const raw = await readFile(filePath, `utf8`)

  if (looksLikeIni(raw)) {
    const parsedIni = parseIniSections(raw)
    const wechatSection = parsedIni[`WeChat:Platform`] || parsedIni.WeChat || parsedIni.wechat || findWechatSection(parsedIni)
    if (!wechatSection) {
      throw new Error(`Missing [WeChat:Platform] section in ${filePath}`)
    }
    return wechatSection
  }

  const parsed = filePath.endsWith(`.json`) ? JSON.parse(raw) : parseSimpleYaml(raw, filePath)
  if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
    throw new Error(`Credentials file must parse to an object: ${filePath}`)
  }
  return parsed as Record<string, any>
}

async function readWechatJson(response: Response, operation: string) {
  const text = await response.text()
  let data: any

  try {
    data = text ? JSON.parse(text) : {}
  }
  catch {
    throw new Error(`${operation} returned non-JSON response: ${text.slice(0, 200)}`)
  }

  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${data.errmsg || text}`)
  }

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`${operation} failed: ${data.errmsg || `errcode ${data.errcode}`}`)
  }

  return data
}

function resolveExistingPath(inputPath: string, searchDirs: string[]) {
  if (path.isAbsolute(inputPath)) {
    return inputPath
  }

  for (const dir of searchDirs.filter(Boolean)) {
    const candidate = path.resolve(dir, inputPath)
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return path.resolve(inputPath)
}

function normalizeApiBase(apiBase: string) {
  return apiBase.replace(/\/+$/, ``)
}

export function expandHomePath(inputPath: string) {
  if (inputPath === `~`) {
    return process.env.HOME || inputPath
  }
  if (inputPath.startsWith(`~/`)) {
    return path.join(process.env.HOME || `~`, inputPath.slice(2))
  }
  return path.resolve(inputPath)
}

function isWechatHostedUrl(url: string) {
  return url.includes(`mmbiz.qpic.cn`) || url.includes(`weixin.qq.com`)
}

function parseDataUrl(source: string): UploadableFile {
  const match = /^data:([^;,]+)?(?:;(base64))?,(.*)$/i.exec(source)
  if (!match) {
    throw new Error(`Invalid data URL`)
  }

  const mimeType = normalizeMimeType(match[1] || `application/octet-stream`)
  const isBase64 = Boolean(match[2])
  const payload = isBase64
    ? Buffer.from(match[3], `base64`)
    : Buffer.from(decodeURIComponent(match[3]), `utf8`)

  return {
    buffer: payload,
    mimeType,
    filename: `inline${extensionFromMimeType(mimeType)}`,
    sourceLabel: `data-url`,
  }
}

function inferMimeType(source: string) {
  const ext = path.extname(source).toLowerCase()
  switch (ext) {
    case `.jpg`:
    case `.jpeg`:
      return `image/jpeg`
    case `.png`:
      return `image/png`
    case `.gif`:
      return `image/gif`
    case `.bmp`:
      return `image/bmp`
    case `.webp`:
      return `image/webp`
    default:
      return `application/octet-stream`
  }
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(`;`)[0].trim().toLowerCase()
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case `image/jpeg`:
      return `.jpg`
    case `image/png`:
      return `.png`
    case `image/gif`:
      return `.gif`
    default:
      return ``
  }
}

function filenameFromSource(source: string) {
  const pathname = new URL(source).pathname
  return path.basename(pathname) || `upload.bin`
}

function normalizeFilenameForMimeType(filename: string, mimeType: string) {
  const desiredExt = extensionFromMimeType(mimeType)
  if (!desiredExt) {
    return filename || `upload.bin`
  }

  const base = filename || `upload`
  const currentExt = path.extname(base).toLowerCase()
  if (currentExt === desiredExt) {
    return base
  }

  const stem = currentExt ? base.slice(0, -currentExt.length) : base
  return `${stem || `upload`}${desiredExt}`
}

function readString(value: unknown, key: string, filePath: string) {
  if (typeof value !== `string` || !value.trim()) {
    throw new Error(`Invalid ${key} in ${filePath}`)
  }
  return value.trim()
}

function readOptionalString(value: unknown, key: string, filePath: string) {
  if (value === undefined || value === null || value === ``) {
    return undefined
  }
  return readString(value, key, filePath)
}

function readOptionalBoolean(value: unknown, key: string, filePath: string) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== `boolean`) {
    throw new Error(`Invalid ${key} in ${filePath}`)
  }
  return value
}

function readBinaryFlag(value: unknown, key: string, filePath: string): 0 | 1 | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (value !== 0 && value !== 1) {
    throw new Error(`Invalid ${key} in ${filePath}; expected 0 or 1`)
  }
  return value
}

function readThumbMaterialType(value: unknown, filePath: string) {
  if (value === undefined || value === null || value === ``) {
    return undefined
  }
  if (value !== `image` && value !== `thumb`) {
    throw new Error(`Invalid thumbMaterialType in ${filePath}; expected "image" or "thumb"`)
  }
  return value
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function extractFirstImageSource(html: string) {
  const match = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/i.exec(html)
  return match?.[2]?.trim() || undefined
}

function replaceImageSrc(tag: string, nextSrc: string) {
  return tag.replace(/\bsrc=(["'])(.*?)\1/i, `src="${
    escapeHtmlAttribute(nextSrc)
  }"`)
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/"/g, `&quot;`)
}

function parseSimpleYaml(raw: string, filePath: string) {
  const result: Record<string, any> = {}
  for (const [index, originalLine] of raw.split(/\r?\n/).entries()) {
    const line = originalLine.trim()
    if (!line || line.startsWith(`#`)) {
      continue
    }

    const separatorIndex = line.indexOf(`:`)
    if (separatorIndex === -1) {
      throw new Error(`Unsupported YAML syntax at ${filePath}:${index + 1}`)
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    result[key] = parseSimpleYamlValue(rawValue)
  }
  return result
}

function parseSimpleYamlValue(rawValue: string) {
  if (!rawValue) {
    return ``
  }
  if ((rawValue.startsWith(`"`) && rawValue.endsWith(`"`)) || (rawValue.startsWith(`'`) && rawValue.endsWith(`'`))) {
    return rawValue.slice(1, -1)
  }
  if (rawValue === `true`) {
    return true
  }
  if (rawValue === `false`) {
    return false
  }
  if (rawValue === `0`) {
    return 0
  }
  if (rawValue === `1`) {
    return 1
  }
  return rawValue
}

function looksLikeIni(raw: string) {
  return raw.split(/\r?\n/).some((line) => /^\s*\[[^\]]+\]\s*$/.test(line))
}

function parseIniSections(raw: string) {
  const sections: Record<string, Record<string, any>> = {}
  let currentSection = ``

  for (const [index, originalLine] of raw.split(/\r?\n/).entries()) {
    const line = originalLine.trim()
    if (!line || line.startsWith(`#`) || line.startsWith(`;`)) {
      continue
    }

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      sections[currentSection] = sections[currentSection] || {}
      continue
    }

    const separatorIndex = line.indexOf(`=`)
    if (separatorIndex === -1) {
      throw new Error(`Unsupported INI syntax at line ${index + 1}`)
    }
    if (!currentSection) {
      throw new Error(`INI key outside section at line ${index + 1}`)
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    sections[currentSection][key] = parseSimpleYamlValue(rawValue)
  }

  return sections
}

function findWechatSection(sections: Record<string, Record<string, any>>) {
  for (const [name, value] of Object.entries(sections)) {
    if (name.toLowerCase().includes(`wechat`)) {
      return value
    }
  }
  return undefined
}
