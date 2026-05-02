const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'CLERK_SECRET_KEY',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_WEBHOOK_SECRET',
]

const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

export const config = Object.freeze({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_WEBHOOK_SECRET: process.env.META_WEBHOOK_SECRET,
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
})
