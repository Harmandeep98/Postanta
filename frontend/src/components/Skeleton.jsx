export function Skeleton({ className = '', style }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="skeleton-stat-grid">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="skeleton-stat-card" />
      ))}
    </div>
  )
}

export function SkeletonRows({ count = 4 }) {
  return Array.from({ length: count }, (_, i) => <Skeleton key={i} className="skeleton-row" />)
}
