import { Link } from 'react-router-dom'

export default function EmptyState({ icon: Icon, title, description, actionTo, actionLabel }) {
  return (
    <div className="empty-state empty-state-rich">
      <div className="empty-state-icon">
        <Icon size={28} strokeWidth={1.75} />
      </div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="post-meta">{description}</p>}
      {actionTo && (
        <Link to={actionTo} className="empty-state-action">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
