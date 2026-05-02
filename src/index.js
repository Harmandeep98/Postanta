import { start } from './server.js'

start().catch((err) => {
  process.stderr.write(`${err.message}\n${err.stack}\n`)
  process.exit(1)
})
