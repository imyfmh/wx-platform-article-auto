import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loadConfig, renderWechatFile } from './wechat-renderer/lib.ts'

async function main() {
  const fixturesDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), `../fixtures`)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `wechat-renderer-`))

  try {
    const config = await loadConfig(path.join(fixturesDir, `real-article.yaml`))
    config.debugOutput = true

    const articlePath = path.join(fixturesDir, `real-article.md`)
    const articleOutput = path.join(tempDir, `real-article.html`)

    const firstRun = await renderWechatFile(articlePath, articleOutput, config)
    const firstHtml = await readFile(articleOutput, `utf8`)
    const secondOutput = path.join(tempDir, `real-article-second.html`)
    await renderWechatFile(articlePath, secondOutput, config)
    const secondHtml = await readFile(secondOutput, `utf8`)

    assert.equal(firstHtml, secondHtml, `same input must produce identical output`)
    assert.match(firstHtml, /<section/i, `output should contain rendered HTML container`)
    assert.doesNotMatch(firstHtml, /var\(--md-primary-color\)/, `primary color vars must be resolved`)
    assert.ok(firstRun.debugPath, `debug output should be created when enabled`)

    const failureConfig = await loadConfig()
    await assert.rejects(
      () => renderWechatFile(
        path.join(fixturesDir, `unsupported-raw-html.md`),
        path.join(tempDir, `unsupported.html`),
        failureConfig,
      ),
      /Unsupported raw HTML block/,
    )

    const files = await readdir(tempDir)
    console.log(`Verification passed. Generated files:`)
    files.forEach(file => console.log(`- ${path.join(tempDir, file)}`))
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
