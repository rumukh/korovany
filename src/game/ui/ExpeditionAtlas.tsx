import { Compass, Map as MapIcon, Maximize, Navigation2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { lockDocumentScroll } from '../../documentScrollLock'
import { EXPEDITION_COPY as copy, describeExpeditionNotice, formatRegionGridLabel } from '../content/gameCopy'
import { FACTION_INFO, ZONE_INFO, type GameView } from '../types'
import type { ExpeditionPreference, ExpeditionTargetIdentity, ExpeditionView } from '../world/ExpeditionPlanner'
import './ExpeditionAtlas.css'

function routeMessage(expedition: ExpeditionView): string {
  if (!expedition.target) return copy.noSelection
  if (expedition.guidance?.arrived) return copy.arrive
  if (expedition.bearingReason === 'fog') return copy.fog
  if (!expedition.route) return copy.plan
  if (expedition.route.status === 'unavailable') return copy.noRoute
  return `${Math.ceil(expedition.route.roadDistance)} ${copy.roadMeters} + ${Math.ceil(expedition.route.connectorDistance)} ${copy.approachMeters}`
}

function nextInstruction(expedition: ExpeditionView): string {
  if (expedition.guidance?.arrived) return copy.arrive
  if (!expedition.route || expedition.route.status === 'unavailable') return copy.bearing
  const next = expedition.guidance?.next
  return next?.kind === 'bridge' ? copy.nextBridge
    : next?.kind === 'destination' ? copy.nextDestination
      : expedition.guidance?.connector ? copy.nextApproach : copy.nextRoad
}

function TransportLayer({ view }: { view: GameView }) {
  const { transport, route, guidance } = view.expedition
  const discovered = new Set(view.worldMap.regions.filter((region) => region.discovered).map((region) => region.id))
  return (
    <g className="expedition-geometry">
      {transport.rivers.map((river) => (
        <line className="expedition-water" key={river.id}
          x1={river.from.x} y1={river.from.z} x2={river.to.x} y2={river.to.z} />
      ))}
      {transport.roads.map((road) => (
        <line className={`expedition-road${road.blocked ? ' blocked' : ''}`} key={road.id}
          x1={road.from.x} y1={road.from.z} x2={road.to.x} y2={road.to.z} />
      ))}
      {route?.legs.map((leg, index) => (
        <line key={`${leg.roadLegId ?? 'connector'}:${index}`}
          className={`expedition-route ${leg.kind}${discovered.has(leg.regionId) ? '' : ' unscouted'}`}
          x1={leg.from.x} y1={leg.from.z} x2={leg.to.x} y2={leg.to.z} />
      ))}
      {transport.bridges.map((bridge) => (
        <g key={bridge.id} className={`expedition-bridge${bridge.unscouted ? ' unscouted' : ''}`}
          transform={`translate(${bridge.position.x} ${bridge.position.z})`}>
          <title>{`${copy.bridge}${bridge.unscouted ? ` - ${copy.unknown}` : ''}`}</title>
          <rect x={-7} y={-3} width={14} height={6} />
          <path d="M-6 -5V5M0 -5V5M6 -5V5" />
        </g>
      ))}
      {route?.status === 'road' && guidance?.next ? (
        <circle className="expedition-next" cx={guidance.next.x} cy={guidance.next.z} r={3} />
      ) : null}
    </g>
  )
}

export function ExpeditionMinimap({ view }: { view: GameView }) {
  const { bounds } = view.worldMap
  return (
    <svg className="expedition-minimap" aria-hidden="true" preserveAspectRatio="none"
      viewBox={`${bounds.minX} ${bounds.minZ} ${bounds.maxX - bounds.minX} ${bounds.maxZ - bounds.minZ}`}>
      <TransportLayer view={view} />
    </svg>
  )
}

export function ExpeditionCompass({ view, onOpen }: { view: GameView; onOpen: () => void }) {
  const { target, guidance } = view.expedition
  const instruction = nextInstruction(view.expedition)
  return (
    <button type="button" className="expedition-compass" onClick={onOpen}
      aria-label={`${copy.open}. ${target ? `${target.title}, ${target.regionLabel}. ${instruction}` : copy.noSelection}`}>
      <span className="expedition-compass-arrow" aria-hidden="true">
        <Navigation2 style={{ transform: `rotate(${guidance?.bearing ?? 0}rad)` }} />
      </span>
      <span className="expedition-compass-copy">
        <strong>{target ? `${target.regionLabel} - ${target.title}` : copy.noSelection}</strong>
        <span>{target ? `${Math.ceil(target.directDistance)} ${copy.straightMeters}` : copy.open}</span>
        {target ? <small>{instruction}{guidance && !guidance.arrived ? ` - ${Math.ceil(guidance.distance)} ${copy.meters}` : ''}</small> : null}
      </span>
      <kbd>M</kbd>
    </button>
  )
}

export interface ExpeditionAtlasProps {
  view: GameView
  onClose: () => void
  onSelect: (target: ExpeditionTargetIdentity | null) => void
  onPreference: (preference: ExpeditionPreference) => void
}

export function ExpeditionAtlas({ view, onClose, onSelect, onPreference }: ExpeditionAtlasProps) {
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const mapElement = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; panX: number; panZ: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, z: 0 })
  const [mobilePane, setMobilePane] = useState<'map' | 'targets'>('map')
  const { bounds, regions } = view.worldMap
  const { expedition } = view
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const width = spanX / zoom
  const depth = spanZ / zoom
  const clampPan = (x: number, z: number) => ({
    x: Math.min((spanX - width) / 2, Math.max(-(spanX - width) / 2, x)),
    z: Math.min((spanZ - depth) / 2, Math.max(-(spanZ - depth) / 2, z)),
  })
  const visiblePan = clampPan(pan.x, pan.z)
  const minX = (bounds.minX + bounds.maxX - width) / 2 + visiblePan.x
  const minZ = (bounds.minZ + bounds.maxZ - depth) / 2 + visiblePan.z
  const columns = Math.max(1, ...regions.map((region) => region.gridX + 1))
  const rows = Math.max(1, ...regions.map((region) => region.gridZ + 1))
  const player = view.markers.find((marker) => marker.kind === 'player')

  useLayoutEffect(() => {
    const previous = document.activeElement
    const unlock = lockDocumentScroll()
    const cancelDrag = () => {
      const id = drag.current?.id
      drag.current = null
      if (id !== undefined && mapElement.current?.hasPointerCapture(id)) mapElement.current.releasePointerCapture(id)
    }
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) closeButton.current?.focus()
    }
    window.addEventListener('blur', cancelDrag)
    document.addEventListener('focusin', keepFocus)
    closeButton.current?.focus()
    return () => {
      cancelDrag()
      window.removeEventListener('blur', cancelDrag)
      document.removeEventListener('focusin', keepFocus)
      unlock()
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) previous.focus()
      else document.querySelector<HTMLButtonElement>('[data-expedition-open]')?.focus()
    }
  }, [])

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])]
      .filter((control) => control.getClientRects().length > 0)
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="expedition-backdrop">
      <section className="expedition-atlas" role="dialog" aria-modal="true"
        aria-labelledby="expedition-title" aria-describedby="expedition-intro" ref={dialog} onKeyDown={trapFocus}>
        <header className="expedition-header">
          <div>
            <span className="expedition-status"><MapIcon aria-hidden="true" />{copy.paused}</span>
            <h2 id="expedition-title">{copy.title}</h2>
          </div>
          <button type="button" className="expedition-icon-button" onClick={onClose} ref={closeButton}
            aria-label={copy.close}><X aria-hidden="true" /></button>
        </header>
        <p className="expedition-intro" id="expedition-intro">{copy.intro}</p>
        <div className="expedition-mobile-switch" role="group" aria-label={copy.atlasPane}>
          {(['map', 'targets'] as const).map((pane) => (
            <button type="button" key={pane} aria-pressed={mobilePane === pane}
              onClick={() => setMobilePane(pane)}>{copy[pane]}</button>
          ))}
        </div>
        <div className="expedition-body" data-pane={mobilePane}>
          <div className="expedition-map-column">
            <div className="expedition-map-toolbar">
              <span>{copy.directions}</span>
              <div>
                <button type="button" aria-label={copy.zoomOut} disabled={zoom <= 1}
                  onClick={() => setZoom((current) => Math.max(1, current / 1.5))}><ZoomOut aria-hidden="true" /></button>
                <button type="button" aria-label={copy.zoomIn} disabled={zoom >= 4}
                  onClick={() => setZoom((current) => Math.min(4, current * 1.5))}><ZoomIn aria-hidden="true" /></button>
                <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, z: 0 }) }}>
                  <Maximize aria-hidden="true" />{copy.fit}</button>
              </div>
            </div>
            <svg className="expedition-map" ref={mapElement} viewBox={`${minX} ${minZ} ${width} ${depth}`} role="img"
              aria-label={`${copy.title}. ${copy.pan}`} tabIndex={0}
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: visiblePan.x, panZ: visiblePan.z }
              }}
              onPointerMove={(event) => {
                const start = drag.current
                if (!start || start.id !== event.pointerId) return
                const rect = event.currentTarget.getBoundingClientRect()
                const scale = Math.min(rect.width / width, rect.height / depth)
                if (scale <= 0) return
                setPan(clampPan(start.panX - (event.clientX - start.x) / scale, start.panZ - (event.clientY - start.y) / scale))
              }}
              onPointerUp={(event) => {
                if (drag.current?.id !== event.pointerId) return
                drag.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { drag.current = null }}
              onLostPointerCapture={() => { drag.current = null }}
              onBlur={() => { drag.current = null }}
              onKeyDown={(event) => {
                const steps: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
                }
                const step = steps[event.key]
                if (!step) return
                event.preventDefault()
                setPan(clampPan(visiblePan.x + step[0] * width * 0.15, visiblePan.z + step[1] * depth * 0.15))
              }}>
              {regions.map((region) => {
                const x = bounds.minX + region.gridX * spanX / columns
                const z = bounds.minZ + region.gridZ * spanZ / rows
                return (
                  <g key={region.id}>
                    <title>{region.discovered
                      ? `${formatRegionGridLabel(region.gridX, region.gridZ)} / ${ZONE_INFO[region.biome].name} / ${region.territory === 'neutral' ? copy.neutral : FACTION_INFO[region.territory].name}`
                      : copy.unknown}</title>
                    <rect x={x} y={z} width={spanX / columns} height={spanZ / rows}
                      className={`expedition-region ${region.discovered ? `known territory-${region.territory}` : 'unknown'}${region.current ? ' current' : ''}`} />
                    <text x={x + 5} y={z + 20 / zoom} className="expedition-grid-label" style={{ fontSize: `${18 / zoom}px` }}>
                      {formatRegionGridLabel(region.gridX, region.gridZ)}{region.discovered ? '' : ' ?'}
                    </text>
                  </g>
                )
              })}
              <TransportLayer view={view} />
              {expedition.targets.map((target) => (
                <g key={target.key} className={`expedition-target${target.key === expedition.target?.key ? ' selected' : ''}`}
                  transform={`translate(${target.position.x} ${target.position.z})`}>
                  <title>{`${target.regionLabel} - ${target.title}`}</title>
                  {target.kind === 'site' ? <rect x={-2.5} y={-2.5} width={5} height={5} />
                    : <path d="M0 -5L4 0L0 5L-4 0Z" />}
                </g>
              ))}
              {player ? (
                <g className="expedition-player" transform={`translate(${player.x} ${player.z}) rotate(${(player.heading ?? 0) * 180 / Math.PI})`}>
                  <circle r={4} /><path d="M0 -13L-4 -5H4Z" />
                </g>
              ) : null}
            </svg>
            <div className="expedition-legend" aria-label={copy.legend}>
              <span><i className="road" />{copy.road}</span>
              <span><i className="river" />{copy.river}</span>
              <span><i className="bridge" />{copy.bridge}</span>
              <span><i className="unscouted" />{copy.unscouted}</span>
              <span><i className="connector" />{copy.connector}</span>
            </div>
            <p className="expedition-map-help">{copy.pan}</p>
            <div className="expedition-route-summary" aria-live="polite">
              <h3><Compass aria-hidden="true" />{copy.itinerary}</h3>
              <p>{routeMessage(expedition)}</p>
              {expedition.route?.status === 'road' ? (
                <>
                  <p className="expedition-next-step">{nextInstruction(expedition)}</p>
                  <p>{expedition.route.regionIds.map((id) => {
                    const region = regions.find((entry) => entry.id === id)
                    return region ? formatRegionGridLabel(region.gridX, region.gridZ) : '?'
                  }).join(' > ')}</p>
                  <p>{copy.knownRisk}: {expedition.route.knownRiskRegionIds.length}.</p>
                  {expedition.route.unscoutedRegionIds.length > 0 ? (
                    <p>{copy.unknownRegions}: {expedition.route.unscoutedRegionIds.length}.</p>
                  ) : null}
                  {expedition.route.connectorDistance > 0 ? <p>{copy.approach}</p> : null}
                </>
              ) : null}
              {expedition.notice ? <p>{describeExpeditionNotice(expedition.notice)}</p> : null}
            </div>
          </div>
          <div className="expedition-destination-column">
            <div className="expedition-preferences" role="group" aria-label={copy.routeOptions}>
              {(['shortest', 'cautious'] as const).map((preference) => (
                <button type="button" key={preference} onClick={() => onPreference(preference)}
                  aria-pressed={expedition.preference === preference}>{copy[preference]}</button>
              ))}
            </div>
            <p className="expedition-risk-note">{copy.riskPolicy}</p>
            {expedition.shortest?.status === 'road' && !expedition.cautious ? (
              <p className="expedition-risk-note">{copy.sameRoute}</p>
            ) : null}
            {expedition.cautious && expedition.shortest ? (
              <p className="expedition-risk-note">
                {copy.shortest}: {Math.ceil(expedition.shortest.roadDistance)} {copy.roadMeters};
                {' '}{copy.cautious}: {Math.ceil(expedition.cautious.roadDistance)} {copy.roadMeters}.
              </p>
            ) : null}
            <header className="expedition-list-header">
              <h3>{copy.destinations}</h3>
              <button type="button" onClick={() => onSelect(null)} disabled={!expedition.target}>{copy.clear}</button>
            </header>
            <div className="expedition-destination-list">
              {expedition.targets.length === 0 ? <p>{copy.empty}</p> : null}
              {expedition.targets.map((target) => {
                const selected = expedition.mode === 'selected' && target.key === expedition.target?.key
                return (
                  <button type="button" className="expedition-destination" key={target.key}
                    aria-pressed={selected} onClick={() => onSelect({ kind: target.kind, id: target.id })}>
                    <span className="expedition-destination-meta">
                      <span>{target.regionLabel} / {copy[target.kind]}</span>
                      <span>{Math.ceil(target.directDistance)} {copy.straightMeters}</span>
                    </span>
                    <strong>{target.title}</strong>
                    {target.timeRemaining !== null ? <span>{Math.ceil(target.timeRemaining)} {copy.seconds}</span> : null}
                    {target.exclusive ? <span className="expedition-exclusive">{copy.exclusive}</span> : null}
                    {target.committed ? <span>{copy.committed}</span> : null}
                    <span className="expedition-select-label">{selected ? copy.selected : copy.select}</span>
                  </button>
                )
              })}
            </div>
            {expedition.target ? (
              <section className="expedition-destination-detail" aria-label={copy.destination}>
                <h3>{expedition.target.regionLabel} / {expedition.target.title}</h3>
                {expedition.target.task ? <p>{expedition.target.task}</p> : null}
                {expedition.target.stake ? <p>{expedition.target.stake}</p> : null}
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
