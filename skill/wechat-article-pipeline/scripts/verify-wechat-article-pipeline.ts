import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ONE_BY_ONE_PNG_BASE64 = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WHZcZ0AAAAASUVORK5CYII=`
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const buildAndPublishScriptPath = path.join(scriptDir, `build-and-publish-wechat-draft.ts`)

async function main() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), `wechat-article-pipeline-`))
  const state = {
    tokenCalls: 0,
    coverUploads: 0,
    bodyUploads: 0,
    draftAdds: 0,
    lastDraftBody: ``,
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
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ media_id: `mock-thumb-media-id` }))
      return
    }

    if (req.method === `POST` && url.pathname === `/cgi-bin/media/uploadimg`) {
      state.bodyUploads += 1
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ url: `https://mmbiz.qpic.cn/mock/body-1.png` }))
      return
    }

    if (req.method === `POST` && url.pathname === `/cgi-bin/draft/add`) {
      state.draftAdds += 1
      state.lastDraftBody = body
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
    const markdownPath = path.join(runDir, `article.md`)
    const htmlPath = path.join(runDir, `article.wechat.html`)
    const bodyImagePath = path.join(runDir, `body.png`)
    const expectedJobPath = path.join(runDir, `article.wechat.draft-job.yaml`)
    const expectedResultPath = path.join(runDir, `article.wechat.draft-result.json`)
    const pwPath = path.join(runDir, `.pw`)

    await writeFile(pwPath, `[WeChat:Platform]\nappid = wx-demo-app\nsecret = wx-demo-secret\n`, `utf8`)
    await writeFile(markdownPath, `# 验证码发展史与现代风控对抗\n\n验证码并不是一个静态题型，而是网站风控对抗自动化攻击的长期演进结果。\n\n![验证码](./body.png)\n`, `utf8`)
    await writeFile(htmlPath, `<h1>验证码发展史与现代风控对抗</h1><p>验证码并不是一个静态题型，而是网站风控对抗自动化攻击的长期演进结果。</p><img src="./body.png" alt="验证码" />\n`, `utf8`)
    await writeFile(bodyImagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, `base64`))

    await execFileAsync(`node`, [
      `--experimental-strip-types`,
      buildAndPublishScriptPath,
      `--markdown`, markdownPath,
      `--html`, htmlPath,
      `--api-base`, `http://127.0.0.1:${address.port}/cgi-bin`,
    ], {
      cwd: runDir,
      env: {
        ...process.env,
        HOME: runDir,
      },
    })

    const jobContent = await readFile(expectedJobPath, `utf8`)
    const result = JSON.parse(await readFile(expectedResultPath, `utf8`))

    if (!jobContent.includes(`title: "验证码发展史与现代风控对抗"`)) {
      throw new Error(`Draft job title was not generated correctly`)
    }
    if (!jobContent.includes(`digest: "验证码并不是一个静态题型，而是网站风控对抗自动化攻击的长期演进结果。"`)) {
      throw new Error(`Draft job digest was not generated correctly`)
    }
    if (jobContent.includes(`thumbImagePath:`)) {
      throw new Error(`Draft job should omit thumbImagePath when relying on first image fallback`)
    }
    if (result.mediaId !== `mock-draft-media-id`) {
      throw new Error(`Unexpected result mediaId`)
    }
    if (state.tokenCalls !== 1 || state.coverUploads !== 1 || state.bodyUploads !== 1 || state.draftAdds !== 1) {
      throw new Error(`Unexpected API call counts: ${JSON.stringify(state)}`)
    }

    console.log(`Verified WeChat article pipeline:`)
    console.log(`- draft job: ${expectedJobPath}`)
    console.log(`- result: ${expectedResultPath}`)
  }
  finally {
    server.close()
    await rm(runDir, { recursive: true, force: true })
  }
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
