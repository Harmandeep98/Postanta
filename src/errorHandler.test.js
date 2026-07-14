import { describe, it, expect, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerErrorHandler } from './errorHandler.js'

describe('registerErrorHandler', () => {
  let fastify

  beforeEach(() => {
    fastify = Fastify({ logger: false })
    registerErrorHandler(fastify)
    fastify.get('/boom', () => {
      throw new Error('column "foo" does not exist in relation "bar"')
    })
    fastify.get('/expected-400', () => {
      const err = new Error('socialAccountId is required')
      err.statusCode = 400
      throw err
    })
  })

  it('replaces an unhandled 500 error message with a generic one', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('Something went wrong. Please try again.')
  })

  it('passes through the message for errors with an explicit 4xx statusCode', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/expected-400' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('socialAccountId is required')
  })
})
