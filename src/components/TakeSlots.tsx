import type { Take } from '../data/models'

interface Props {
  takes: Take[]
  armedSlots: number[]
  noTakeActive: boolean
  auditioningTakeId?: string
  onArm: (slot: number) => void
  onDisarm: (slot?: number) => void
  onSelect: (takeId: string) => void
  onAudition: (takeId: string) => void
  onSelectNone: () => void
  onDelete: (takeId: string) => void
  onToggleLock: (takeId: string) => void
}

export function TakeSlots({ takes, armedSlots, noTakeActive, auditioningTakeId, onArm, onDisarm, onSelect, onAudition, onSelectNone, onDelete, onToggleLock }: Props) {
  return (
    <div className="take-slots" aria-label="Bar takes">
      {Array.from({ length: 5 }, (_, slot) => {
        const take = takes[slot]
        const armed = armedSlots.includes(slot)
        const auditioning = Boolean(take && take.takeId === auditioningTakeId)
        const label = armed
          ? `Disarm Take ${slot + 1}`
          : take?.selected
            ? `Audition Take ${slot + 1} on its own (right-click to delete)`
            : take
              ? `Use Take ${slot + 1} for playback (right-click to delete)`
              : `Arm Take ${slot + 1}`
        return (
          <div className="take-pad-wrap" key={slot}>
            <button
              type="button"
              className={`take-pad ${take ? 'take-recorded' : 'take-empty'} ${take?.selected ? 'take-selected' : ''} ${auditioning ? 'take-auditioning' : ''} ${armed ? 'take-armed' : ''}`}
              aria-label={label}
              title={label}
              onClick={(event) => {
                event.stopPropagation()
                if (armed) onDisarm(slot)
                else if (take?.selected) onAudition(take.takeId)
                else if (take) onSelect(take.takeId)
                else onArm(slot)
              }}
              onContextMenu={(event) => {
                if (!take || armed) return
                event.preventDefault()
                event.stopPropagation()
                if (!take.locked) onDelete(take.takeId)
              }}
            >
              {slot + 1}
            </button>
            {take && !armed && (
              <span
                role="button"
                tabIndex={0}
                className={`take-lock ${take.locked ? 'take-lock-on' : ''}`}
                aria-pressed={take.locked ?? false}
                aria-label={take.locked ? `Unlock Take ${slot + 1}` : `Lock Take ${slot + 1} to protect it from deletion`}
                title={take.locked ? `Unlock Take ${slot + 1}` : `Lock Take ${slot + 1} to protect it from deletion`}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleLock(take.takeId)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  onToggleLock(take.takeId)
                }}
              >
                {take.locked ? '★' : '☆'}
              </span>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className={`take-pad take-none ${noTakeActive ? 'take-selected' : ''}`}
        disabled={armedSlots.length > 0}
        aria-label="Play this bar without a vocal take"
        title="Play this bar without a vocal take"
        onClick={(event) => {
          event.stopPropagation()
          onSelectNone()
        }}
      >
        Ø
      </button>
    </div>
  )
}
