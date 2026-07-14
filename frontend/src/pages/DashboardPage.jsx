import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Send,
  CalendarClock,
  XCircle,
  Zap,
  Eye,
  Users,
  Heart,
  MessageCircle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Compass,
  Sparkles,
  Wand2,
  SearchX,
} from 'lucide-react'
import { useApiClient } from '../lib/api'
import { useSelectedAccount } from '../context/AccountContext'
import { Skeleton, SkeletonRows, SkeletonStatGrid } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const OUTCOMES = ['EXECUTED', 'SKIPPED_ONCE_PER_USER', 'SKIPPED_COOLDOWN', 'FAILED']
const QUEUE_LABEL = { automation: 'Automation', posts: 'Posts', tokenRefresh: 'Token Refresh' }
const QUEUE_ICON = { automation: Zap, posts: CalendarClock, tokenRefresh: RefreshCw }
const OUTCOME_ICON = {
  EXECUTED: CheckCircle2,
  FAILED: XCircle,
  SKIPPED_ONCE_PER_USER: Clock,
  SKIPPED_COOLDOWN: Clock,
}
const ACTION_LABEL = { SEND_DM: 'sent a DM', REPLY_COMMENT: 'replied to a comment', REPLY_DM: 'replied in DM' }

function timeAgo(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.round(diffHr / 24)}d ago`
}

function activitySentence(log, rule) {
  const keyword = rule ? `"${rule.triggerKeyword}"` : 'a rule'
  if (log.outcome === 'EXECUTED') return `Automation ${ACTION_LABEL[rule?.actionType] ?? 'ran'} for keyword ${keyword}`
  if (log.outcome === 'FAILED') return `Automation failed for keyword ${keyword}${log.errorMessage ? ` — ${log.errorMessage}` : ''}`
  if (log.outcome === 'SKIPPED_ONCE_PER_USER') return `Skipped keyword ${keyword} — user already replied to once`
  return `Skipped keyword ${keyword} — still in cooldown`
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <div className="stat-value mono">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const api = useApiClient()
  const { selectedAccountId } = useSelectedAccount()
  const [ruleFilter, setRuleFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showSystemStatus, setShowSystemStatus] = useState(false)

  const { data: queues } = useQuery({
    queryKey: ['dashboard-queues'],
    queryFn: () => api.get('/dashboard/queues'),
    refetchInterval: 10000,
  })

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['dashboard-analytics', selectedAccountId],
    queryFn: () => api.get(`/dashboard/analytics/rules?socialAccountId=${selectedAccountId}`),
    enabled: !!selectedAccountId,
  })

  const { data: postAnalytics, isLoading: postAnalyticsLoading } = useQuery({
    queryKey: ['dashboard-post-analytics', selectedAccountId],
    queryFn: () => api.get(`/dashboard/analytics/posts?socialAccountId=${selectedAccountId}`),
    enabled: !!selectedAccountId,
  })

  const logsParams = new URLSearchParams({ socialAccountId: selectedAccountId ?? '', page, limit: 20 })
  if (ruleFilter) logsParams.set('ruleId', ruleFilter)
  if (outcomeFilter) logsParams.set('outcome', outcomeFilter)

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['dashboard-rule-logs', selectedAccountId, ruleFilter, outcomeFilter, page],
    queryFn: () => api.get(`/dashboard/rule-logs?${logsParams.toString()}`),
    enabled: !!selectedAccountId,
  })

  const { data: recentActivity } = useQuery({
    queryKey: ['dashboard-recent-activity', selectedAccountId],
    queryFn: () => api.get(`/dashboard/rule-logs?socialAccountId=${selectedAccountId}&limit=8`),
    enabled: !!selectedAccountId,
  })

  const { ruleById, messagesSent, activeRules } = useMemo(() => {
    const rules = analytics?.rules ?? []
    return {
      ruleById: new Map(rules.map((r) => [r.ruleId, r])),
      messagesSent: rules.reduce((sum, r) => sum + r.counts.EXECUTED, 0),
      activeRules: rules.filter((r) => r.isActive).length,
    }
  }, [analytics])

  if (!selectedAccountId) {
    return (
      <EmptyState
        icon={Compass}
        title="No account selected"
        description="Pick an Instagram account to see your dashboard."
        actionTo="/accounts"
        actionLabel="Go to Accounts"
      />
    )
  }

  return (
    <div>
      <h1>Dashboard</h1>

      {(analyticsLoading || postAnalyticsLoading) ? (
        <>
          <section className="dash-section">
            <h2>Posts</h2>
            <SkeletonStatGrid count={7} />
          </section>
          <section className="dash-section">
            <h2>Automations</h2>
            <SkeletonStatGrid count={2} />
          </section>
        </>
      ) : (
        <>
          <section className="dash-section">
            <h2>Posts</h2>
            <div className="stat-grid">
              <StatCard icon={CalendarClock} label="Scheduled" value={postAnalytics.postStats.scheduled} />
              <StatCard icon={CheckCircle2} label="Published" value={postAnalytics.postStats.published} />
              <StatCard icon={XCircle} label="Failed" value={postAnalytics.postStats.failed} />
              <StatCard icon={Eye} label="Impressions" value={postAnalytics.engagement.totalImpressions} />
              <StatCard icon={Users} label="Reach" value={postAnalytics.engagement.totalReach} />
              <StatCard icon={Heart} label="Likes" value={postAnalytics.engagement.totalLikes} />
              <StatCard icon={MessageCircle} label="Comments" value={postAnalytics.engagement.totalComments} />
            </div>
            {postAnalytics.engagement.postsWithMetrics === 0 && postAnalytics.postStats.published > 0 && (
              <p className="post-meta">Engagement metrics aren't available yet for your published posts — Instagram can take a little while to make insights available after publishing.</p>
            )}
          </section>

          <section className="dash-section">
            <h2>Automations</h2>
            <div className="stat-grid">
              <StatCard icon={Send} label="Messages Sent" value={messagesSent} />
              <StatCard icon={Zap} label="Active Rules" value={activeRules} />
            </div>
          </section>

          <section className="dash-section">
            <h2>Recent Activity</h2>
            {!recentActivity ? (
              <SkeletonRows count={4} />
            ) : recentActivity.data.length === 0 ? (
              <EmptyState icon={Sparkles} title="No automation activity yet" description="Triggered rules will show up here." />
            ) : (
              <ul className="activity-feed">
                {recentActivity.data.map((log) => {
                  const OutcomeIcon = OUTCOME_ICON[log.outcome]
                  const rule = ruleById.get(log.ruleId)
                  return (
                    <li key={log.id} className={`activity-item activity-${log.outcome === 'EXECUTED' ? 'ok' : log.outcome === 'FAILED' ? 'bad' : 'neutral'}`}>
                      <OutcomeIcon size={16} />
                      <span>{activitySentence(log, rule)}</span>
                      <span className="post-meta">{timeAgo(log.createdAt)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="dash-section">
        <h2>Rule Analytics</h2>
        {analyticsLoading ? (
          <SkeletonRows count={3} />
        ) : analytics.rules.length === 0 ? (
          <EmptyState
            icon={Wand2}
            title="No automation rules for this account yet"
            description="Create one on the Automations page."
            actionTo="/automations"
            actionLabel="Go to Automations"
          />
        ) : (
          <div className="table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Trigger → Action</th>
                  <th>Active</th>
                  <th>Executed</th>
                  <th>Skipped (once)</th>
                  <th>Skipped (cooldown)</th>
                  <th>Failed</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {analytics.rules.map((rule) => (
                  <tr key={rule.ruleId}>
                    <td>{rule.triggerKeyword}</td>
                    <td>
                      {rule.triggerType} → {rule.actionType}
                    </td>
                    <td>{rule.isActive ? 'Yes' : 'No'}</td>
                    <td className="mono">{rule.counts.EXECUTED}</td>
                    <td className="mono">{rule.counts.SKIPPED_ONCE_PER_USER}</td>
                    <td className="mono">{rule.counts.SKIPPED_COOLDOWN}</td>
                    <td className="mono">{rule.counts.FAILED}</td>
                    <td className="mono">{rule.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dash-section">
        <h2>Execution Log</h2>
        <div className="log-filters">
          {analytics && (
            <select value={ruleFilter} onChange={(e) => { setRuleFilter(e.target.value); setPage(1) }}>
              <option value="">All rules</option>
              {analytics.rules.map((rule) => (
                <option key={rule.ruleId} value={rule.ruleId}>
                  {rule.triggerKeyword}
                </option>
              ))}
            </select>
          )}
          <select value={outcomeFilter} onChange={(e) => { setOutcomeFilter(e.target.value); setPage(1) }}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        {logsLoading ? (
          <SkeletonRows count={5} />
        ) : logs.data.length === 0 ? (
          <EmptyState icon={SearchX} title="No log entries match these filters" description="Try a different rule or outcome." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>IG User</th>
                    <th>Outcome</th>
                    <th>Error</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.map((log) => (
                    <tr key={log.id}>
                      <td className="mono">{log.ruleId}</td>
                      <td className="mono">{log.instagramUserId}</td>
                      <td>
                        <span className={`status-badge ${log.outcome === 'EXECUTED' ? 'status-published' : log.outcome === 'FAILED' ? 'status-failed' : ''}`}>
                          {(() => {
                            const OutcomeIcon = OUTCOME_ICON[log.outcome]
                            return <OutcomeIcon size={13} />
                          })()}
                          {log.outcome}
                        </span>
                      </td>
                      <td>{log.errorMessage ?? '—'}</td>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={15} />
                Prev
              </button>
              <span>
                Page {logs.pagination.page} of {Math.max(logs.pagination.totalPages, 1)} ({logs.pagination.total} total)
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page >= logs.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}
      </section>

      <section className="dash-section">
        <button type="button" className="secondary system-status-toggle" onClick={() => setShowSystemStatus((v) => !v)}>
          <ChevronDown size={15} className={showSystemStatus ? 'chevron-open' : ''} />
          System status (for debugging)
        </button>
        {showSystemStatus && (
          !queues ? (
            <div className="queue-grid">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} style={{ height: 96 }} />
              ))}
            </div>
          ) : (
            <div className="queue-grid">
              {Object.entries(queues).map(([name, counts]) => {
                const QueueIcon = QUEUE_ICON[name]
                return (
                  <div key={name} className="queue-card">
                    <h3>
                      {QueueIcon && <QueueIcon size={15} />}
                      {QUEUE_LABEL[name] ?? name}
                    </h3>
                    <dl>
                      {Object.entries(counts).map(([k, v]) => (
                        <div key={k} className="queue-stat">
                          <dt>{k}</dt>
                          <dd className="mono">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )
              })}
            </div>
          )
        )}
      </section>
    </div>
  )
}
