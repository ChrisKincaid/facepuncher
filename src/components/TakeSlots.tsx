import type { Take } from '../data/models'

interface Props {
  takes: Take[]
  armedSlots: number[]
  onArm: (slot: number) => void
  onDisarm: (slot?: number) => void
  onSelect: (takeId: string) => void
  onListen: (takeId: string) => void
  onSelectNone: () => void
  onDelete: (takeId: string) => void
  onToggleLock: (takeId: string) => void
}

export function TakeSlots({ takes, armedSlots, onArm, onDisarm, onSelect, onListen, onSelectNone, onDelete, onToggleLock }: Props) {
  const slotCount = Math.min(5, Math.max(1, takes.length + armedSlots.length + 1))

  return (
    <div className="take-slots" aria-label="Bar takes">
      {Array.from({ length: slotCount }, (_, slot) => {
        const take = takes[slot]
        const armed = armedSlots.includes(slot)
        return (
          <div key={slot} className={`take-slot ${take ? 'take-recorded' : 'take-empty'} ${armed ? 'take-armed' : ''}`}>
            <button
              className="take-pad"
              title={armed ? `Disarm Take ${slot + 1}` : take ? `Use Take ${slot + 1} for playback` : `Arm Take ${slot + 1}`}
              onClick={(event) => {
                event.stopPropagation()
                if (armed) onDisarm(slot)
                else if (take) onSelect(take.takeId)
                else onArm(slot)
              }}
            >
              <strong>{slot + 1}</strong>
              <span>{armed ? 'REC' : take ? 'TAKE' : 'EMPTY'}</span>
            </button>
            {take && !armed ? (
              <button
                className={`take-use-light ${take.selected ? 'take-use-active' : ''}`}
                aria-label={`Use Take ${slot + 1} for playback`}
                title={`Use Take ${slot + 1} for playback`}
                onClick={(event) => { event.stopPropagation(); onSelect(take.takeId) }}
              />
            ) : <span className="take-use-light take-use-disabled" />}
            <div className="take-slot-actions">
              <button className="take-action" onClick={(event) => {
                event.stopPropagation()
                if (armed) onDisarm(slot)
                else onArm(slot)
              }}>
                {armed ? 'Cancel' : 'Rec'}
              </button>
              {take && <button className="take-action" onClick={(event) => {
                event.stopPropagation()
                onToggleLock(take.takeId)
              }}>{take.locked ? 'Unlock' : 'Lock'}</button>}
              {take && <button className="take-action" onClick={(event) => {
                event.stopPropagation()
                onListen(take.takeId)
              }}>Listen</button>}
              {take && <button className="take-action take-delete" disabled={Boolean(take.locked)} onClick={(event) => {
                event.stopPropagation()
                onDelete(take.takeId)
              }}>Del</button>}
            </div>
          </div>
        )
      })}
      <button
        className={`no-take-button ${!armedSlots.length && !takes.some((take) => take.selected) ? 'no-take-active' : ''}`}
        disabled={Boolean(armedSlots.length)}
        onClick={(event) => { event.stopPropagation(); onSelectNone() }}
      >
        No take
      </button>
    </div>
  )
}
