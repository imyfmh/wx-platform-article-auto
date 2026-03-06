import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { selectCoverImage } from './select-cover.ts'

const ONE_BY_ONE_PNG_BASE64 = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WHZcZ0AAAAASUVORK5CYII=`

async function main() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), `auto-cover-selector-`))
  const state = {
    pexelsQueries: [] as string[],
    pixabayQueries: [] as string[],
    pixabayPerPages: [] as string[],
    downloads: [] as string[],
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || `/`, `http://127.0.0.1`)

    if (req.method === `GET` && url.pathname === `/pexels/search`) {
      state.pexelsQueries.push(url.searchParams.get(`query`) || ``)
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({
        photos: [
          {
            id: 101,
            width: 1800,
            height: 1000,
            url: `https://example.com/pexels/101`,
            src: {
              landscape: `http://127.0.0.1:${address.port}/images/pexels-101.png`,
            },
          },
        ],
      }))
      return
    }

    if (req.method === `GET` && url.pathname === `/pixabay`) {
      state.pixabayQueries.push(url.searchParams.get(`q`) || ``)
      state.pixabayPerPages.push(url.searchParams.get(`per_page`) || ``)
      res.writeHead(200, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({
        hits: [
          {
            id: 202,
            imageWidth: 1200,
            imageHeight: 1200,
            pageURL: `https://example.com/pixabay/202`,
            largeImageURL: `http://127.0.0.1:${address.port}/images/pixabay-202.png`,
          },
        ],
      }))
      return
    }

    if (req.method === `GET` && url.pathname.startsWith(`/images/`)) {
      state.downloads.push(url.pathname)
      res.writeHead(200, { 'Content-Type': `image/png` })
      res.end(Buffer.from(ONE_BY_ONE_PNG_BASE64, `base64`))
      return
    }

    res.writeHead(404, { 'Content-Type': `application/json` })
    res.end(JSON.stringify({ error: `not found` }))
  })

  await new Promise<void>((resolve) => server.listen(0, `127.0.0.1`, () => resolve()))
  const address = server.address()
  if (!address || typeof address === `string`) {
    throw new Error(`Failed to start verification server`)
  }

  try {
    const credentialsPath = path.join(runDir, `.pw`)
    const markdownPath = path.join(runDir, `article.md`)
    const outputStem = path.join(runDir, `article.cover`)

    await writeFile(credentialsPath, `[pexels]\napiKey = demo-pexels\n[pixabay]\napiKey = demo-pixabay\n`, `utf8`)
    await writeFile(markdownPath, `# OpenClaw，到底是科技爆炸还是流量噱头？\n\n这是一篇关于 AI Agent、自动化与产品化的文章。\n`, `utf8`)

    const result = await selectCoverImage({
      title: `OpenClaw，到底是科技爆炸还是流量噱头？`,
      digest: `一篇关于 AI Agent 自动化与产品叙事的评论文章。`,
      markdownPath,
      outputPath: outputStem,
      credentialsPath,
      pexelsApiBase: `http://127.0.0.1:${address.port}/pexels`,
      pixabayApiBase: `http://127.0.0.1:${address.port}/pixabay`,
    })

    if (!result.coverPath.endsWith(`.png`)) {
      throw new Error(`Expected cover path to end with .png`)
    }
    if (result.provider !== `pexels`) {
      throw new Error(`Expected Pexels candidate to win`)
    }
    if (!state.pexelsQueries.length || !state.pixabayQueries.length) {
      throw new Error(`Expected both providers to be queried`)
    }
    if (!state.pixabayPerPages.every((value) => Number(value) >= 3)) {
      throw new Error(`Expected Pixabay per_page to stay within the validated range`)
    }
    if (!state.downloads.includes(`/images/pexels-101.png`)) {
      throw new Error(`Expected the selected cover image to be downloaded`)
    }

    const coverBytes = await readFile(result.coverPath)
    if (!coverBytes.byteLength) {
      throw new Error(`Expected the cover file to be written`)
    }

    console.log(`Verified auto cover selector:`)
    console.log(`- cover: ${result.coverPath}`)
    console.log(`- provider: ${result.provider}`)
  }
  finally {
    server.close()
    await rm(runDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
