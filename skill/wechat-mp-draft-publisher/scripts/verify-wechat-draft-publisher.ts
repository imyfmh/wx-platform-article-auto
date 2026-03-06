import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { publishWechatDraft } from './wechat-draft-publisher/lib.ts'

const ONE_BY_ONE_PNG_BASE64 = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WHZcZ0AAAAASUVORK5CYII=`

async function main() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), `wechat-draft-publisher-`))

  const state = {
    tokenCalls: 0,
    coverUploads: 0,
    bodyUploads: 0,
    draftAdds: 0,
    lastDraftBody: ``,
    lastCoverUploadBody: ``,
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || `/`, `http://127.0.0.1`)
    const body = await readRequestBody(req)

    if (req.method === `POST` && url.pathname === `/cgi-bin/stable_token`) {
      state.tokenCalls += 1
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ access_token: `mock-access-token`, expires_in: 7200 }))
      return
    }

    if (req.method === `POST` && url.pathname === `/cgi-bin/material/add_material`) {
      state.coverUploads += 1
      state.lastCoverUploadBody = body
      if (!body.includes(`filename="`)) {
        res.writeHead(400, { 'Content-Type': `application/json` })
        res.end(JSON.stringify({ errcode: 1, errmsg: `cover upload missing expected file` }))
        return
      }
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ media_id: `mock-thumb-media-id`, url: `https://mmbiz.qpic.cn/mock/cover.png` }))
      return
    }

    if (req.method === `GET` && url.pathname === `/mock/cover.avis`) {
      res.writeHead(200, { 'Content-Type': `image/png` })
      res.end(Buffer.from(ONE_BY_ONE_PNG_BASE64, `base64`))
      return
    }

    if (req.method === `POST` && url.pathname === `/cgi-bin/media/uploadimg`) {
      state.bodyUploads += 1
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ url: `https://mmbiz.qpic.cn/mock/body-${state.bodyUploads}.png` }))
      return
    }

    if (req.method === `POST` && url.pathname === `/cgi-bin/draft/add`) {
      state.draftAdds += 1
      state.lastDraftBody = body
      const payload = JSON.parse(body)
      const article = payload.articles?.[0]

      if (!article || article.thumb_media_id !== `mock-thumb-media-id`) {
        res.writeHead(400, { 'Content-Type': `application/json` })
        res.end(JSON.stringify({ errcode: 2, errmsg: `thumb_media_id mismatch` }))
        return
      }
      if (!String(article.content || ``).includes(`https://mmbiz.qpic.cn/mock/body-1.png`)) {
        res.writeHead(400, { 'Content-Type': `application/json` })
        res.end(JSON.stringify({ errcode: 3, errmsg: `content image was not rewritten` }))
        return
      }

      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ media_id: `mock-draft-media-id` }))
      return
    }

    res.writeHead(404, { 'Content-Type': `application/json` })
    res.end(JSON.stringify({ errcode: 404, errmsg: `not found` }))
  })

  await new Promise<void>((resolve) => server.listen(0, `127.0.0.1`, () => resolve()))
  const address = server.address()
  if (!address || typeof address === `string`) {
    throw new Error(`Failed to start verification server`)
  }

  try {
    await verifyExplicitCoverFlow(runDir, address.port, state)
    resetState(state)
    await verifyFirstImageFallbackFlow(runDir, address.port, state)
    resetState(state)
    await verifyRemoteCoverMimeNormalizationFlow(runDir, address.port, state)

    console.log(`Verified WeChat draft publisher:`)
    console.log(`- explicit cover flow: ok`)
    console.log(`- first image fallback flow: ok`)
    console.log(`- remote cover MIME normalization flow: ok`)
  }
  finally {
    server.close()
    await rm(runDir, { recursive: true, force: true })
  }
}

async function verifyExplicitCoverFlow(runDir: string, port: number, state: {
  tokenCalls: number
  coverUploads: number
  bodyUploads: number
  draftAdds: number
  lastDraftBody: string
}) {
    const htmlPath = path.join(runDir, `article.wechat.html`)
    const coverPath = path.join(runDir, `cover.png`)
    const bodyImagePath = path.join(runDir, `body.png`)
    const credentialsPath = path.join(runDir, `credentials.yaml`)
    const jobPath = path.join(runDir, `draft-job.yaml`)
    const resultPath = path.join(runDir, `draft-result.json`)

    const imageBuffer = Buffer.from(ONE_BY_ONE_PNG_BASE64, `base64`)
    await writeFile(coverPath, imageBuffer)
    await writeFile(bodyImagePath, imageBuffer)
    await writeFile(htmlPath, `<section><p>正文</p><img src="./body.png" alt="body" /><img src="https://mmbiz.qpic.cn/existing.png" alt="existing" /></section>\n`, `utf8`)
    await writeFile(credentialsPath, `appId: wx-demo-app\nappSecret: wx-demo-secret\n`, `utf8`)
    await writeFile(jobPath, `htmlPath: ./article.wechat.html\ntitle: 验证标题\ndigest: 验证摘要\nauthor: 验证作者\nthumbImagePath: ./cover.png\n`, `utf8`)

    const result = await publishWechatDraft({
      credentialsPath,
      jobPath,
      outputPath: resultPath,
      apiBase: `http://127.0.0.1:${port}/cgi-bin`,
    })

    if (result.mediaId !== `mock-draft-media-id`) {
      throw new Error(`Unexpected mediaId: ${result.mediaId}`)
    }
    if (result.thumbMediaId !== `mock-thumb-media-id`) {
      throw new Error(`Unexpected thumbMediaId: ${result.thumbMediaId}`)
    }
    if (result.uploadedContentImageCount !== 1) {
      throw new Error(`Expected one uploaded content image, got ${result.uploadedContentImageCount}`)
    }
    if (state.tokenCalls !== 1 || state.coverUploads !== 1 || state.bodyUploads !== 1 || state.draftAdds !== 1) {
      throw new Error(`Unexpected API call counts: ${JSON.stringify(state)}`)
    }

    const written = JSON.parse(await readFile(resultPath, `utf8`))
    if (written.mediaId !== `mock-draft-media-id`) {
      throw new Error(`Output file missing expected mediaId`)
    }
}

async function verifyFirstImageFallbackFlow(runDir: string, port: number, state: {
  tokenCalls: number
  coverUploads: number
  bodyUploads: number
  draftAdds: number
  lastDraftBody: string
  lastCoverUploadBody: string
}) {
  const htmlPath = path.join(runDir, `article-fallback.wechat.html`)
  const firstImagePath = path.join(runDir, `fallback-cover.png`)
  const credentialsPath = path.join(runDir, `credentials-ini.pw`)
  const jobPath = path.join(runDir, `draft-job-fallback.yaml`)

  const imageBuffer = Buffer.from(ONE_BY_ONE_PNG_BASE64, `base64`)
  await writeFile(firstImagePath, imageBuffer)
  await writeFile(htmlPath, `<section><img src="./fallback-cover.png" alt="cover" /><p>正文</p></section>\n`, `utf8`)
  await writeFile(credentialsPath, `[WeChat:Platform]\nappid = wx-demo-app\nsecret = wx-demo-secret\n`, `utf8`)
  await writeFile(jobPath, `htmlPath: ./article-fallback.wechat.html\ntitle: 回退封面标题\n`, `utf8`)

  const result = await publishWechatDraft({
    credentialsPath,
    jobPath,
    apiBase: `http://127.0.0.1:${port}/cgi-bin`,
  })

  if (result.mediaId !== `mock-draft-media-id`) {
    throw new Error(`Unexpected fallback mediaId: ${result.mediaId}`)
  }
  if (result.thumbMediaId !== `mock-thumb-media-id`) {
    throw new Error(`Unexpected fallback thumbMediaId: ${result.thumbMediaId}`)
  }
  if (result.uploadedContentImageCount !== 1) {
    throw new Error(`Expected fallback flow to upload one content image, got ${result.uploadedContentImageCount}`)
  }
  if (state.tokenCalls !== 1 || state.coverUploads !== 1 || state.bodyUploads !== 1 || state.draftAdds !== 1) {
    throw new Error(`Unexpected fallback API call counts: ${JSON.stringify(state)}`)
  }
}

async function verifyRemoteCoverMimeNormalizationFlow(runDir: string, port: number, state: {
  tokenCalls: number
  coverUploads: number
  bodyUploads: number
  draftAdds: number
  lastDraftBody: string
  lastCoverUploadBody: string
}) {
  const htmlPath = path.join(runDir, `article-remote-cover.wechat.html`)
  const bodyImagePath = path.join(runDir, `body-remote-cover.png`)
  const credentialsPath = path.join(runDir, `credentials-remote-cover.yaml`)
  const jobPath = path.join(runDir, `draft-job-remote-cover.yaml`)

  const imageBuffer = Buffer.from(ONE_BY_ONE_PNG_BASE64, `base64`)
  await writeFile(bodyImagePath, imageBuffer)
  await writeFile(htmlPath, `<section><p>正文</p><img src="./body-remote-cover.png" alt="body" /></section>\n`, `utf8`)
  await writeFile(credentialsPath, `appId: wx-demo-app\nappSecret: wx-demo-secret\n`, `utf8`)
  await writeFile(jobPath, `htmlPath: ./article-remote-cover.wechat.html\ntitle: 远程封面标题\nthumbImagePath: http://127.0.0.1:${port}/mock/cover.avis\n`, `utf8`)

  const result = await publishWechatDraft({
    credentialsPath,
    jobPath,
    apiBase: `http://127.0.0.1:${port}/cgi-bin`,
  })

  if (result.mediaId !== `mock-draft-media-id`) {
    throw new Error(`Unexpected remote-cover mediaId: ${result.mediaId}`)
  }
  if (!state.lastCoverUploadBody.includes(`filename="cover.png"`)) {
    throw new Error(`Expected remote cover upload filename to be normalized to cover.png`)
  }
  if (state.tokenCalls !== 1 || state.coverUploads !== 1 || state.bodyUploads !== 1 || state.draftAdds !== 1) {
    throw new Error(`Unexpected remote-cover API call counts: ${JSON.stringify(state)}`)
  }
}

function resetState(state: {
  tokenCalls: number
  coverUploads: number
  bodyUploads: number
  draftAdds: number
  lastDraftBody: string
  lastCoverUploadBody: string
}) {
  state.tokenCalls = 0
  state.coverUploads = 0
  state.bodyUploads = 0
  state.draftAdds = 0
  state.lastDraftBody = ``
  state.lastCoverUploadBody = ``
}

function readRequestBody(req: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on(`data`, (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on(`end`, () => resolve(Buffer.concat(chunks).toString(`utf8`)))
    req.on(`error`, reject)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
