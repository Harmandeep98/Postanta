import { config } from '../config.js'

const GRAPH_URL = 'https://graph.facebook.com/v21.0'

async function graphFetch(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    let message = 'Meta API error'
    try {
      const data = await res.json()
      message = data.error?.message ?? message
    } catch {}
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}

export async function exchangeCodeForShortLivedToken(code) {
  const url = new URL(`${GRAPH_URL}/oauth/access_token`)
  url.searchParams.set('client_id', config.META_APP_ID)
  url.searchParams.set('client_secret', config.META_APP_SECRET)
  url.searchParams.set('redirect_uri', config.META_REDIRECT_URI)
  url.searchParams.set('code', code)
  const data = await graphFetch(url)
  return { accessToken: data.access_token }
}

export async function exchangeForLongLivedToken(shortLivedToken) {
  const url = new URL(`${GRAPH_URL}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', config.META_APP_ID)
  url.searchParams.set('client_secret', config.META_APP_SECRET)
  url.searchParams.set('fb_exchange_token', shortLivedToken)
  const data = await graphFetch(url)
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function refreshLongLivedToken(accessToken) {
  const url = new URL(`${GRAPH_URL}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', config.META_APP_ID)
  url.searchParams.set('client_secret', config.META_APP_SECRET)
  url.searchParams.set('fb_exchange_token', accessToken)
  const data = await graphFetch(url)
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function getInstagramAccounts(userToken) {
  const pagesUrl = new URL(`${GRAPH_URL}/me/accounts`)
  pagesUrl.searchParams.set('access_token', userToken)
  pagesUrl.searchParams.set('fields', 'id,instagram_business_account')
  const pagesData = await graphFetch(pagesUrl)

  const pages = (pagesData.data ?? []).filter((p) => p.instagram_business_account?.id)

  const results = await Promise.allSettled(
    pages.map(async (page) => {
      const igId = page.instagram_business_account.id
      const igUrl = new URL(`${GRAPH_URL}/${igId}`)
      igUrl.searchParams.set('fields', 'username')
      igUrl.searchParams.set('access_token', userToken)
      const igData = await graphFetch(igUrl)
      return { instagramAccountId: igId, username: igData.username }
    }),
  )

  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
}

export async function getValidToken(socialAccount, prisma) {
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  if (socialAccount.tokenExpiresAt > sevenDaysFromNow) {
    return socialAccount.accessToken
  }
  const { accessToken, expiresIn } = await refreshLongLivedToken(socialAccount.accessToken)
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)
  await prisma.socialAccount.update({
    where: { id: socialAccount.id },
    data: { accessToken, tokenExpiresAt },
  })
  return accessToken
}

export async function publishImage(instagramAccountId, accessToken, { imageUrl, caption }) {
  const url = new URL(`${GRAPH_URL}/${instagramAccountId}/media`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('image_url', imageUrl)
  if (caption) url.searchParams.set('caption', caption)
  const data = await graphFetch(url, { method: 'POST' })
  return data.id
}

export async function createVideoContainer(instagramAccountId, accessToken, { videoUrl, caption }) {
  const url = new URL(`${GRAPH_URL}/${instagramAccountId}/media`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('video_url', videoUrl)
  url.searchParams.set('media_type', 'REELS')
  if (caption) url.searchParams.set('caption', caption)
  const data = await graphFetch(url, { method: 'POST' })
  return data.id
}

export async function getContainerStatus(containerId, accessToken) {
  const url = new URL(`${GRAPH_URL}/${containerId}`)
  url.searchParams.set('fields', 'status_code')
  url.searchParams.set('access_token', accessToken)
  const data = await graphFetch(url)
  return data.status_code
}

// Likes/comments live on the media object itself; impressions/reach/saved are insights-only.
// Fetched in parallel since they're independent Graph API calls.
export async function getMediaMetrics(mediaId, accessToken) {
  const fieldsUrl = new URL(`${GRAPH_URL}/${mediaId}`)
  fieldsUrl.searchParams.set('fields', 'like_count,comments_count,media_type,permalink,timestamp')
  fieldsUrl.searchParams.set('access_token', accessToken)

  const insightsUrl = new URL(`${GRAPH_URL}/${mediaId}/insights`)
  insightsUrl.searchParams.set('metric', 'impressions,reach,saved')
  insightsUrl.searchParams.set('access_token', accessToken)

  const [fields, insights] = await Promise.all([graphFetch(fieldsUrl), graphFetch(insightsUrl)])

  const metricValue = (name) => insights.data?.find((m) => m.name === name)?.values?.[0]?.value ?? 0

  return {
    likeCount: fields.like_count ?? 0,
    commentsCount: fields.comments_count ?? 0,
    mediaType: fields.media_type,
    permalink: fields.permalink,
    impressions: metricValue('impressions'),
    reach: metricValue('reach'),
    saved: metricValue('saved'),
  }
}

const MEDIA_METRICS_CACHE_TTL_SECONDS = 600

// Insights don't change second-to-second and Meta rate-limits the Graph API —
// cache per media ID so a dashboard reload doesn't re-hit Meta for every post.
export async function getMediaMetricsCached(mediaId, accessToken, redis) {
  const cacheKey = `media-metrics:${mediaId}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const metrics = await getMediaMetrics(mediaId, accessToken)
  await redis.set(cacheKey, JSON.stringify(metrics), 'EX', MEDIA_METRICS_CACHE_TTL_SECONDS)
  return metrics
}

export async function publishContainer(instagramAccountId, accessToken, containerId) {
  const url = new URL(`${GRAPH_URL}/${instagramAccountId}/media_publish`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('creation_id', containerId)
  const data = await graphFetch(url, { method: 'POST' })
  return data.id
}

export async function getUserProfile(instagramUserId, accessToken) {
  const url = new URL(`${GRAPH_URL}/${instagramUserId}`)
  url.searchParams.set('fields', 'name')
  url.searchParams.set('access_token', accessToken)
  const data = await graphFetch(url)
  const name = data.name ?? ''
  const first_name = name.split(' ')[0] || 'there'
  return { name, first_name }
}

export async function sendDm(recipientId, message, accessToken) {
  const url = new URL(`${GRAPH_URL}/me/messages`)
  url.searchParams.set('access_token', accessToken)
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } }),
  })
}

export async function replyToComment(commentId, message, accessToken) {
  const url = new URL(`${GRAPH_URL}/${commentId}/replies`)
  url.searchParams.set('access_token', accessToken)
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

// Meta Messaging API uses recipient.id as the thread identifier for in-thread replies
export async function replyInThread(threadId, message, accessToken) {
  const url = new URL(`${GRAPH_URL}/me/messages`)
  url.searchParams.set('access_token', accessToken)
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: threadId }, message: { text: message } }),
  })
}
