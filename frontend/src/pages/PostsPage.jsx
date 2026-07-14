import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Pencil, Trash2, Clock, CheckCircle2, XCircle, Compass, CalendarPlus } from 'lucide-react'
import { useApiClient } from '../lib/api'
import { useSelectedAccount } from '../context/AccountContext'
import { SkeletonRows } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { pushToast } from '../lib/toast'
import { optimisticList } from '../lib/optimisticList'

const STATUS_ICON = {
  DRAFT: Pencil,
  SCHEDULED: Clock,
  PUBLISHED: CheckCircle2,
  FAILED: XCircle,
}

const STATUS_LABEL = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
}

function toLocalInputValue(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function PostsPage() {
  const api = useApiClient()
  const queryClient = useQueryClient()
  const { selectedAccountId } = useSelectedAccount()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const { data: posts, isLoading, error } = useQuery({
    queryKey: ['posts', selectedAccountId],
    queryFn: () => api.get(`/posts?socialAccountId=${selectedAccountId}`),
    enabled: !!selectedAccountId,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['posts', selectedAccountId] })

  const createPost = useMutation({
    mutationFn: (body) => api.post('/posts', { ...body, socialAccountId: selectedAccountId }),
    onSuccess: () => {
      invalidate()
      setShowForm(false)
    },
  })

  const postsKey = ['posts', selectedAccountId]

  const updatePost = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/posts/${id}`, body),
    ...optimisticList(queryClient, postsKey, (old, { id, body }) => old?.map((p) => (p.id === id ? { ...p, ...body } : p))),
    onSuccess: () => setEditingId(null),
    onSettled: invalidate,
  })

  const deletePost = useMutation({
    mutationFn: (id) => api.del(`/posts/${id}`),
    ...optimisticList(queryClient, postsKey, (old, id) => old?.filter((p) => p.id !== id)),
    onSettled: invalidate,
  })

  if (!selectedAccountId) {
    return (
      <EmptyState
        icon={Compass}
        title="No account selected"
        description="Pick an Instagram account to schedule posts."
        actionTo="/accounts"
        actionLabel="Go to Accounts"
      />
    )
  }
  if (error) return <p className="error">{error.message}</p>

  return (
    <div>
      <div className="page-header">
        <h1>Posts</h1>
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Close' : 'New Post'}
        </button>
      </div>

      {showForm && (
        <PostForm
          submitLabel="Schedule"
          onSubmit={(body) => createPost.mutate(body)}
          pending={createPost.isPending}
        />
      )}

      {isLoading ? (
        <SkeletonRows count={3} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title="No scheduled posts yet"
          description="Click New Post above to schedule your first one."
        />
      ) : (
        <ul className="post-list">
          {posts.map((post) => (
            <li key={post.id} className="post-card">
              {editingId === post.id ? (
                <PostForm
                  initial={post}
                  submitLabel="Save"
                  onSubmit={(body) => updatePost.mutate({ id: post.id, body })}
                  onCancel={() => setEditingId(null)}
                  pending={updatePost.isPending}
                />
              ) : (
                <>
                  <div>
                    <span className={`status-badge status-${post.status.toLowerCase()}`}>
                      {(() => {
                        const StatusIcon = STATUS_ICON[post.status]
                        return <StatusIcon size={13} />
                      })()}
                      {STATUS_LABEL[post.status]}
                    </span>
                    <p className="post-caption">{post.caption || <em>No caption</em>}</p>
                    <p className="post-meta">{new Date(post.scheduledAt).toLocaleString()}</p>
                    {post.errorMessage && <p className="error">{post.errorMessage}</p>}
                  </div>
                  <div className="post-actions">
                    {post.status !== 'PUBLISHED' && (
                      <button type="button" className="secondary" onClick={() => setEditingId(post.id)}>
                        <Pencil size={15} />
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary danger"
                      onClick={() => deletePost.mutate(post.id)}
                      disabled={deletePost.isPending}
                    >
                      <Trash2 size={15} />
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PostForm({ initial, submitLabel, onSubmit, onCancel, pending }) {
  const api = useApiClient()
  const [caption, setCaption] = useState(initial?.caption ?? '')
  const [mediaUrl, setMediaUrl] = useState(initial?.mediaUrl ?? '')
  const [scheduledAt, setScheduledAt] = useState(initial ? toLocalInputValue(initial.scheduledAt) : '')
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const { uploadUrl, mediaUrl: publicUrl } = await api.get(
        `/media/upload-url?contentType=${encodeURIComponent(file.type)}`,
      )
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      setMediaUrl(publicUrl)
    } catch (err) {
      pushToast(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({ caption, mediaUrl: mediaUrl || undefined, scheduledAt: new Date(scheduledAt).toISOString() })
  }

  return (
    <form className="post-form" onSubmit={handleSubmit}>
      <textarea placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} />
      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={handleFile} disabled={uploading} />
      {mediaUrl && (
        <p className="post-meta success-text">
          <CheckCircle2 size={14} /> Media attached
        </p>
      )}
      <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
      <div className="post-actions">
        <button type="submit" disabled={pending || uploading || !scheduledAt}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            <X size={15} />
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
