import path from 'node:path'

import { DEFAULT_CREDENTIALS_PATH, expandHomePath, parseCliArgs, publishWechatDraft } from './wechat-draft-publisher/lib.ts'

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  const result = await publishWechatDraft({
    credentialsPath: expandHomePath(args.credentials || DEFAULT_CREDENTIALS_PATH),
    jobPath: path.resolve(args.job),
    outputPath: args.output ? path.resolve(args.output) : undefined,
    apiBase: args.apiBase,
  })

  console.log(`Published WeChat draft:`)
  console.log(`- credentials: ${expandHomePath(args.credentials || DEFAULT_CREDENTIALS_PATH)}`)
  console.log(`- media_id: ${result.mediaId}`)
  console.log(`- thumb_media_id: ${result.thumbMediaId}`)
  console.log(`- uploaded_content_images: ${result.uploadedContentImageCount}`)
  if (result.outputPath) {
    console.log(`- output: ${result.outputPath}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
