import { useAuth } from '@clerk/clerk-react'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

export function useApiClient() {
  const { getToken } = useAuth()

  async function request(path, options = {}) {
    const token = await getToken()
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Request failed: ${res.status}`)
    }

    if (res.status === 204) return null
    return res.json()
  }

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
    del: (path) => request(path, { method: 'DELETE' }),
  }
}
