import { useLayoutEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { lockDocumentScroll } from '../../documentScrollLock'

export function CampaignJournal({ children, onClose }: {
  children: ReactNode
  onClose: () => void
}) {
  useLayoutEffect(() => lockDocumentScroll(), [])
  return (
    <div className="modal-backdrop journal-backdrop">
      <section className="campaign-journal" role="dialog" aria-modal="true"
        aria-labelledby="journal-title">
        <header className="journal-header">
          <div>
            <h2 id="journal-title">Твой поход</h2>
            <p>Мир на паузе. Выбери дело — дорога подождёт.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть журнал">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="journal-content">{children}</div>
      </section>
    </div>
  )
}
