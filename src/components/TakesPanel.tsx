import type { Take } from '../data/models'

interface Props {
  takes: Take[]
  maxReached: boolean
  onSelect: (takeId: string) => void
  onDelete: (takeId: string) => void
}

export function TakesPanel({ takes, maxReached, onSelect, onDelete }: Props) {
  const takeSlots = Array.from({ length: 5 }).map((_, idx) => takes[idx])
  return (
    <div className="panel">
      <div className="section-title">
        <h3>Takes</h3>
        {maxReached ? <span className="tag">Max 5 takes reached</span> : <span className="text-muted">Select / delete</span>}
      </div>
      <div className="takes-grid">
        {takeSlots.map((take, idx) => (
          <div key={idx} className={`take-btn ${take?.selected ? 'active' : ''}`}>
            <div>Take {idx + 1}</div>
            <div className="text-muted" style={{ marginTop: 4 }}>
              {take ? new Date(take.createdAt).toLocaleTimeString() : 'Empty'}
            </div>
            {take ? (
              <div className="flex-gap" style={{ marginTop: 6 }}>
                <button className="secondary" onClick={() => onSelect(take.takeId)}>
                  Activate
                </button>
                <button className="danger" onClick={() => onDelete(take.takeId)}>
                  Delete
                </button>
              </div>
            ) : (
              <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                Slot free
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
