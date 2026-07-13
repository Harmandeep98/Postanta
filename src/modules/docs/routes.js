import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const docsHtml = readFileSync(join(__dirname, 'docs.html'), 'utf8')

export default async function docsRoutes(fastify) {
  fastify.get('/docs', { schema: { hide: true } }, async (request, reply) => {
    return reply.type('text/html').send(docsHtml)
  })
}
