import { config } from '../config.js'

const GRAPH_URL = 'https://graph.facebook.com/v21.0'

async function graphFetch(url) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message ?? 'Meta API error')
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
