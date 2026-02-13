/**
 * Compact sidebar widget - the "degen liquidation signal".
 * Shows the KEY metric: aggregated $ near liquidation by distance band.
 * "LONGS $5.3M in 2%" = if price drops 2%, $5.3M gets liquidated.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'

interface Position {
  coin: string
  positionSize: number
  leverage: number
  liquidationPrice: number
  markPrice: number
  entryPrice: number
  side: 'long' | 'short'
  pctToLiquidation: number
  wallet: string
  walletFull: string
  unrealizedPnl: number
}

interface Bands {
  longsByPct: Record<string, number>
  shortsByPct: Record<string, number>
}

const DEFAULT_REFRESH = 30
const HL_EXPLORER = 'https://app.hyperliquid.xyz/explorer/address/'

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  if (v > 0) return `$${v.toFixed(0)}`
  return '$0'
}

export function LiquidationPanel({ onOpenDashboard }: { onOpenDashboard?: () => void }): React.ReactElement {
  const [positions, setPositions] = useState<Position[]>([])
  const [bands, setBands] = useState<Bands | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem('liq-panel-expanded')
    return stored === null ? true : stored === 'true'
  })

  const mountedRef = useRef(true)

  useEffect(() => { localStorage.setItem('liq-panel-expanded', String(isExpanded)) }, [isExpanded])

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const result = await window.electronAPI?.liquidationFetch({ maxDistancePct: 15 })
      if (!mountedRef.current) return
      if (result?.success) {
        setPositions(result.positions || [])
        setBands(result.bands || null)
        setError(null)
      } else {
        setError(result?.error ?? 'Failed to fetch')
      }
    } catch (e) {
      if (mountedRef.current) setError(String(e))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (isExpanded) fetchData()
    const interval = setInterval(() => {
      if (isExpanded) fetchData(false)
    }, DEFAULT_REFRESH * 1000)
    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [fetchData, isExpanded])

  // Top 5 closest to liquidation
  const topPositions = positions.slice(0, 5)

  // Key signal: which side has more $ near liq?
  const longsIn2 = bands?.longsByPct?.['2'] ?? 0
  const shortsIn2 = bands?.shortsByPct?.['2'] ?? 0
  const longsIn5 = bands?.longsByPct?.['5'] ?? 0
  const shortsIn5 = bands?.shortsByPct?.['5'] ?? 0

  return (
    <div className="liq-panel">
      <div
        className="liq-panel-header"
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsExpanded(!isExpanded)
          }
        }}
        aria-expanded={isExpanded}
      >
        <span className="liq-toggle" aria-hidden="true">
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="liq-title">Near Liquidation</span>
        {positions.length > 0 && <span className="liq-count">{positions.length}</span>}
      </div>

      {isExpanded && (
        <div className="liq-panel-content">
          {loading && positions.length === 0 && (
            <div className="liq-loading">Loading...</div>
          )}
          {error && !loading && (
            <div className="liq-error">{error}</div>
          )}

          {bands && (longsIn2 > 0 || shortsIn2 > 0 || longsIn5 > 0 || shortsIn5 > 0) && (
            <div className="liq-bands">
              {/* The key signal */}
              <div className="liq-band-row">
                <span className="liq-band-label">in 2%:</span>
                <span className="liq-band-long">{'\u2197'} {formatUsd(longsIn2)}</span>
                <span className="liq-band-short">{'\u2198'} {formatUsd(shortsIn2)}</span>
                {(longsIn2 > 0 || shortsIn2 > 0) && (
                  <span className={`liq-band-signal ${longsIn2 > shortsIn2 ? 'bearish' : 'bullish'}`}>
                    {longsIn2 > shortsIn2 ? '\u25BC' : '\u25B2'}
                  </span>
                )}
              </div>
              <div className="liq-band-row">
                <span className="liq-band-label">in 5%:</span>
                <span className="liq-band-long">{'\u2197'} {formatUsd(longsIn5)}</span>
                <span className="liq-band-short">{'\u2198'} {formatUsd(shortsIn5)}</span>
                {(longsIn5 > 0 || shortsIn5 > 0) && (
                  <span className={`liq-band-signal ${longsIn5 > shortsIn5 ? 'bearish' : 'bullish'}`}>
                    {longsIn5 > shortsIn5 ? '\u25BC' : '\u25B2'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Top positions closest to liq */}
          {topPositions.length > 0 && (
            <div className="liq-compact-list">
              {topPositions.map((pos, i) => (
                <div
                  key={`${pos.wallet}-${pos.coin}-${pos.side}-${i}`}
                  className={`liq-compact-row ${pos.side}`}
                  onClick={() => {
                    if (pos.walletFull) window.electronAPI?.openExternal(`${HL_EXPLORER}${pos.walletFull}`)
                  }}
                  style={{ cursor: pos.walletFull ? 'pointer' : 'default' }}
                >
                  <span className="liq-compact-coin">{pos.coin}</span>
                  <span className="liq-compact-size">{formatUsd(pos.positionSize)}</span>
                  <span className="liq-compact-lev">{pos.leverage}x</span>
                  <span className={`liq-compact-dist ${pos.pctToLiquidation < 2 ? 'critical' : pos.pctToLiquidation < 5 ? 'warning' : ''}`}>
                    {pos.pctToLiquidation.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && positions.length === 0 && bands === null && (
            <div className="liq-empty">No positions near liquidation</div>
          )}

          {positions.length > 5 && (
            <div className="liq-more-hint">
              +{positions.length - 5} more near liq
            </div>
          )}

          {onOpenDashboard && (
            <button className="liq-open-dashboard" onClick={onOpenDashboard}>
              Open Dashboard {'\u2197'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
