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
}

export function TakeSlots({ takes, armedSlots, noTakeActive, auditioningTakeId, onArm, onDisarm, onSelect, onAudition, onSelectNone, onDelete }: Props) {
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
          <button
            key={slot}
            type="button"
            className={`take-pad ${take ? 'take-recorded' : 'take-empty'} ${take?.selected ? 'take-selected' : ''} ${auditioning ? 'take-auditioning' : ''} ${armed ? 'take-armed' : ''} ${take?.locked ? 'take-locked' : ''}`}
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
              onDelete(take.takeId)
            }}
          >
            {slot + 1}
          </button>
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
