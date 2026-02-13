/**
 * Compact sidebar widget for whale positions (the "degen view").
 * Shows top ~8 most critical positions at a glance.
 * Click header or "Open Dashboard" to launch full-screen overlay.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'

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

const DEFAULT_REFRESH = 30
const DEFAULT_MAX_DIST = 100
const HL_EXPLORER = 'https://app.hyperliquid.xyz/explorer/address/'

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function formatPnl(v: number): string {
  const sign = v >= 0 ? '+' : ''
  if (Math.abs(v) >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${sign}$${(v / 1_000).toFixed(0)}K`
  return `${sign}$${v.toFixed(0)}`
}

function CompactPositionRow({ pos }: { pos: Position }): React.ReactElement {
  return (
    <div
      className={`liq-compact-row ${pos.side}`}
      onClick={() => {
        if (pos.walletFull) window.electronAPI?.openExternal(`${HL_EXPLORER}${pos.walletFull}`)
      }}
      style={{ cursor: pos.walletFull ? 'pointer' : 'default' }}
      title={`${pos.coin} ${pos.side.toUpperCase()} ${formatUsd(pos.positionSize)} ${pos.leverage}x`}
    >
      <span className="liq-compact-coin">{pos.coin}</span>
      <span className="liq-compact-size">{formatUsd(pos.positionSize)}</span>
      <span className="liq-compact-lev">{pos.leverage}x</span>
      <span className={`liq-compact-pnl ${pos.unrealizedPnl >= 0 ? 'profit' : 'loss'}`}>
        {formatPnl(pos.unrealizedPnl)}
      </span>
      {pos.pctToLiquidation >= 0 ? (
        <span className={`liq-compact-dist ${pos.pctToLiquidation < 2 ? 'critical' : pos.pctToLiquidation < 5 ? 'warning' : ''}`}>
          {pos.pctToLiquidation.toFixed(1)}%
        </span>
      ) : (
        <span className="liq-compact-dist safe">safe</span>
      )}
    </div>
  )
}

export function LiquidationPanel({ onOpenDashboard }: { onOpenDashboard?: () => void }): React.ReactElement {
  const [positions, setPositions] = useState<Position[]>([])
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
      const result = await window.electronAPI?.liquidationFetch({ maxDistancePct: DEFAULT_MAX_DIST })
      if (!mountedRef.current) return
      if (result?.success && result.positions) {
        setPositions(result.positions)
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

  // Show top positions sorted by proximity to liquidation, max 8
  const topPositions = useMemo(() => {
    return [...positions]
      .sort((a, b) => {
        if (a.pctToLiquidation >= 0 && b.pctToLiquidation >= 0) return a.pctToLiquidation - b.pctToLiquidation
        if (a.pctToLiquidation >= 0) return -1
        if (b.pctToLiquidation >= 0) return 1
        return b.positionSize - a.positionSize
      })
      .slice(0, 8)
  }, [positions])

  const longCount = positions.filter((p) => p.side === 'long').length
  const shortCount = positions.filter((p) => p.side === 'short').length

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
        <span className="liq-title">Liquidations</span>
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

          {positions.length > 0 && (
            <>
              {/* Mini summary */}
              <div className="liq-mini-summary">
                <span className="liq-mini-long">{'\u2197'} {longCount}L</span>
                <span className="liq-mini-short">{'\u2198'} {shortCount}S</span>
              </div>

              {/* Top positions compact list */}
              <div className="liq-compact-list">
                {topPositions.map((pos, i) => (
                  <CompactPositionRow key={`${pos.wallet}-${pos.coin}-${pos.side}-${i}`} pos={pos} />
                ))}
              </div>

              {positions.length > 8 && (
                <div className="liq-more-hint">
                  +{positions.length - 8} more positions
                </div>
              )}
            </>
          )}

          {/* Open Dashboard button */}
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
