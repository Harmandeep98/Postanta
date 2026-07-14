import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Zap, CalendarClock, RefreshCw, CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { useApiClient } from '../lib/api'
import { useSelectedAccount } from '../context/AccountContext'

const OUTCOMES = ['EXECUTED', 'SKIPPED_ONCE_PER_USER', 'SKIPPED_COOLDOWN', 'FAILED']
const QUEUE_LABEL = { automation: 'Automation', posts: 'Posts', tokenRefresh: 'Token Refresh' }
const QUEUE_ICON = { automation: Zap, posts: CalendarClock, tokenRefresh: RefreshCw }
const OUTCOME_ICON = {
  EXECUTED: CheckCircle2,
  FAILED: XCircle,
  SKIPPED_ONCE_PER_USER: Clock,
  SKIPPED_COOLDOWN: Clock,
}

export default function DashboardPage() {
  const api = useApiClient()
  const { selectedAccountId } = useSelectedAccount()
  const [ruleFilter, setRuleFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [page, setPage] = useState(1)

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

  const logsParams = new URLSearchParams({ socialAccountId: selectedAccountId ?? '', page, limit: 20 })
  if (ruleFilter) logsParams.set('ruleId', ruleFilter)
  if (outcomeFilter) logsParams.set('outcome', outcomeFilter)

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['dashboard-rule-logs', selectedAccountId, ruleFilter, outcomeFilter, page],
    queryFn: () => api.get(`/dashboard/rule-logs?${logsParams.toString()}`),
    enabled: !!selectedAccountId,
  })

  return (
    <div>
      <h1>Dashboard</h1>

      <section className="dash-section">
        <h2>Queues</h2>
        {!queues ? (
          <p>Loading…</p>
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
        )}
      </section>

      {!selectedAccountId ? (
        <p>Select an account on the Accounts page to see rule analytics and logs.</p>
      ) : (
        <>
          <section className="dash-section">
            <h2>Rule Analytics</h2>
            {analyticsLoading ? (
              <p>Loading…</p>
            ) : analytics.rules.length === 0 ? (
              <div className="empty-state">No automation rules for this account yet.</div>
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
              <p>Loading…</p>
            ) : logs.data.length === 0 ? (
              <div className="empty-state">No log entries match these filters.</div>
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
        </>
      )}
    </div>
  )
}
