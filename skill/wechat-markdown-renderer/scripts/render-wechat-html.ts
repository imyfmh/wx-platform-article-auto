import path from 'node:path'

import { loadConfig, parseCliArgs, renderWechatFile } from './wechat-renderer/lib.ts'

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  const inputPath = path.resolve(args.input)
  const outputPath = path.resolve(args.output || defaultOutputPath(inputPath))
  const config = await loadConfig(args.config ? path.resolve(args.config) : undefined)

  if (typeof args.debug === `boolean`) {
    config.debugOutput = args.debug
  }
  if (typeof args.strict === `boolean`) {
    config.strict = args.strict
  }

  const result = await renderWechatFile(inputPath, outputPath, config)

  console.log(`Rendered WeChat HTML:`)
  console.log(`- input: ${inputPath}`)
  console.log(`- output: ${result.outputPath}`)
  if (result.debugPath) {
    console.log(`- intermediate: ${result.debugPath}`)
  }
}

function defaultOutputPath(inputPath: string) {
  const parsed = path.parse(inputPath)
  return path.join(parsed.dir, `${parsed.name}.wechat.html`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
