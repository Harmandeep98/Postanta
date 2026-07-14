import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Pencil, Trash2, Power, PowerOff } from 'lucide-react'
import { useApiClient } from '../lib/api'
import { useSelectedAccount } from '../context/AccountContext'

const ACTIONS_BY_TRIGGER = {
  COMMENT_KEYWORD: ['SEND_DM', 'REPLY_COMMENT'],
  DM_KEYWORD: ['REPLY_DM'],
}

const ACTION_LABEL = {
  SEND_DM: 'Send DM',
  REPLY_COMMENT: 'Reply to comment',
  REPLY_DM: 'Reply in DM',
}

const TRIGGER_LABEL = {
  COMMENT_KEYWORD: 'Comment contains keyword',
  DM_KEYWORD: 'DM contains keyword',
}

export default function AutomationsPage() {
  const api = useApiClient()
  const queryClient = useQueryClient()
  const { selectedAccountId } = useSelectedAccount()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const { data: rules, isLoading, error } = useQuery({
    queryKey: ['automations', selectedAccountId],
    queryFn: () => api.get(`/automations?socialAccountId=${selectedAccountId}`),
    enabled: !!selectedAccountId,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['automations', selectedAccountId] })

  const createRule = useMutation({
    mutationFn: (body) => api.post('/automations', { ...body, socialAccountId: selectedAccountId }),
    onSuccess: () => {
      invalidate()
      setShowForm(false)
    },
  })

  const updateRule = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/automations/${id}`, body),
    onSuccess: () => {
      invalidate()
      setEditingId(null)
    },
  })

  const deleteRule = useMutation({
    mutationFn: (id) => api.del(`/automations/${id}`),
    onSuccess: invalidate,
  })

  if (!selectedAccountId) return <p>Select an account on the Accounts page first.</p>
  if (isLoading) return <p>Loading automations…</p>
  if (error) return <p className="error">{error.message}</p>

  return (
    <div>
      <div className="page-header">
        <h1>Automations</h1>
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Close' : 'New Rule'}
        </button>
      </div>

      {showForm && (
        <RuleForm
          submitLabel="Create Rule"
          onSubmit={(body) => createRule.mutate(body)}
          pending={createRule.isPending}
          error={createRule.error}
        />
      )}

      {rules.length === 0 ? (
        <div className="empty-state">No automation rules yet.</div>
      ) : (
        <ul className="post-list">
          {rules.map((rule) => (
            <li key={rule.id} className="post-card">
              {editingId === rule.id ? (
                <RuleForm
                  initial={rule}
                  submitLabel="Save"
                  onSubmit={(body) => updateRule.mutate({ id: rule.id, body })}
                  onCancel={() => setEditingId(null)}
                  pending={updateRule.isPending}
                  error={updateRule.error}
                />
              ) : (
                <>
                  <div>
                    <span className={`status-badge ${rule.isActive ? 'status-scheduled' : ''}`}>
                      {rule.isActive ? <Power size={13} /> : <PowerOff size={13} />}
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <p className="post-caption">
                      {TRIGGER_LABEL[rule.triggerType]} "<strong>{rule.triggerKeyword}</strong>" ({rule.matchType}) →{' '}
                      {ACTION_LABEL[rule.actionType]}
                    </p>
                    <p className="post-meta">
                      {rule.replyOncePerUser ? 'Once per user' : `Cooldown ${rule.cooldownMinutes}m`}
                      {rule.postId ? ` · post ${rule.postId}` : ' · all posts'}
                    </p>
                  </div>
                  <div className="post-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateRule.mutate({ id: rule.id, body: { isActive: !rule.isActive } })}
                      disabled={updateRule.isPending}
                    >
                      {rule.isActive ? <PowerOff size={15} /> : <Power size={15} />}
                      {rule.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" className="secondary" onClick={() => setEditingId(rule.id)}>
                      <Pencil size={15} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="secondary danger"
                      onClick={() => deleteRule.mutate(rule.id)}
                      disabled={deleteRule.isPending}
                    >
                      <Trash2 size={15} />
                      Delete
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

function RuleForm({ initial, submitLabel, onSubmit, onCancel, pending, error }) {
  const [triggerType, setTriggerType] = useState(initial?.triggerType ?? 'COMMENT_KEYWORD')
  const [matchType, setMatchType] = useState(initial?.matchType ?? 'CONTAINS')
  const [triggerKeyword, setTriggerKeyword] = useState(initial?.triggerKeyword ?? '')
  const [actionType, setActionType] = useState(initial?.actionType ?? ACTIONS_BY_TRIGGER.COMMENT_KEYWORD[0])
  const [messageTemplate, setMessageTemplate] = useState(initial?.messageTemplate ?? '')
  const [postId, setPostId] = useState(initial?.postId ?? '')
  const [replyOncePerUser, setReplyOncePerUser] = useState(initial?.replyOncePerUser ?? true)
  const [cooldownMinutes, setCooldownMinutes] = useState(initial?.cooldownMinutes ?? 60)

  const availableActions = ACTIONS_BY_TRIGGER[triggerType]

  function handleTriggerChange(value) {
    setTriggerType(value)
    if (!ACTIONS_BY_TRIGGER[value].includes(actionType)) {
      setActionType(ACTIONS_BY_TRIGGER[value][0])
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({
      triggerType,
      matchType,
      triggerKeyword,
      actionType,
      messageTemplate,
      postId: triggerType === 'DM_KEYWORD' ? null : postId || null,
      replyOncePerUser,
      cooldownMinutes: Number(cooldownMinutes),
    })
  }

  return (
    <form className="post-form" onSubmit={handleSubmit}>
      <label>
        Trigger
        <select value={triggerType} onChange={(e) => handleTriggerChange(e.target.value)}>
          {Object.keys(ACTIONS_BY_TRIGGER).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABEL[t]}
            </option>
          ))}
        </select>
      </label>

      <input
        placeholder="Keyword (e.g. price)"
        value={triggerKeyword}
        onChange={(e) => setTriggerKeyword(e.target.value)}
        required
      />

      <label>
        Match type
        <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
          <option value="CONTAINS">Contains</option>
          <option value="EXACT">Exact match</option>
          <option value="STARTS_WITH">Starts with</option>
        </select>
      </label>

      <label>
        Action
        <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
          {availableActions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
      </label>

      <textarea
        placeholder="Message template — supports {{first_name}}"
        value={messageTemplate}
        onChange={(e) => setMessageTemplate(e.target.value)}
        rows={3}
        required
      />

      {triggerType === 'COMMENT_KEYWORD' && (
        <input
          placeholder="Specific post ID (optional — blank = all posts)"
          value={postId}
          onChange={(e) => setPostId(e.target.value)}
        />
      )}

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={replyOncePerUser}
          onChange={(e) => setReplyOncePerUser(e.target.checked)}
        />
        Only reply once per user
      </label>

      {!replyOncePerUser && (
        <label>
          Cooldown (minutes)
          <input
            type="number"
            min="0"
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(e.target.value)}
          />
        </label>
      )}

      {error && <p className="error">{error.message}</p>}

      <div className="post-actions">
        <button type="submit" disabled={pending}>
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
