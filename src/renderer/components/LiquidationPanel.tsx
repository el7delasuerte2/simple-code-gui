import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'

interface Position {
  coin: string
  positionSize: number
  leverage: number
  liquidationPrice: number
  markPrice: number
  entryPrice: number
  side: 'long' | 'short'
  pctToLiquidation: number  // -1 means no liq price (cross margin, safe)
  wallet: string
  unrealizedPnl: number
}

const DEFAULT_REFRESH = 30
const DEFAULT_MAX_DIST = 100
const QUICK_FILTERS = ['ALL', 'BTC', 'ETH', 'SOL', 'DOGE', 'HYPE']

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function formatPrice(v: number): string {
  if (v >= 10_000) return v.toFixed(0)
  if (v >= 100) return v.toFixed(2)
  if (v >= 1) return v.toFixed(4)
  return v.toFixed(6)
}

function formatPnl(v: number): string {
  const sign = v >= 0 ? '+' : ''
  if (Math.abs(v) >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${sign}$${(v / 1_000).toFixed(0)}K`
  return `${sign}$${v.toFixed(0)}`
}

function sortPositions(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => {
    if (a.pctToLiquidation >= 0 && b.pctToLiquidation >= 0) {
      return a.pctToLiquidation - b.pctToLiquidation
    }
    if (a.pctToLiquidation >= 0) return -1
    if (b.pctToLiquidation >= 0) return 1
    return b.positionSize - a.positionSize
  })
}

function PositionCard({ pos }: { pos: Position }): React.ReactElement {
  return (
    <div className={`liq-position ${pos.side}`}>
      <div className="liq-pos-top">
        <span className="liq-pos-coin">{pos.coin}</span>
        <span className="liq-pos-size">{formatUsd(pos.positionSize)}</span>
        <span className="liq-pos-leverage">{pos.leverage}x</span>
        {pos.pctToLiquidation >= 0 ? (
          <span
            className={`liq-pos-distance ${pos.pctToLiquidation < 2 ? 'critical' : pos.pctToLiquidation < 5 ? 'warning' : ''}`}
          >
            {pos.pctToLiquidation.toFixed(1)}%
          </span>
        ) : (
          <span className="liq-pos-distance safe">safe</span>
        )}
      </div>
      <div className="liq-pos-bottom">
        <span className="liq-pos-wallet">{pos.wallet}</span>
        <span className={`liq-pos-pnl ${pos.unrealizedPnl >= 0 ? 'profit' : 'loss'}`}>
          {formatPnl(pos.unrealizedPnl)}
        </span>
        {pos.liquidationPrice > 0 && (
          <>
            <span className="liq-pos-arrow">{'\u2192'}</span>
            <span className="liq-pos-liq-price">${formatPrice(pos.liquidationPrice)}</span>
          </>
        )}
      </div>
    </div>
  )
}

export function LiquidationPanel(): React.ReactElement {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // Client-side ticker filter (instant, no re-fetch)
  const [activeFilter, setActiveFilter] = useState<string>(() => {
    return localStorage.getItem('liq-active-filter') || 'ALL'
  })

  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem('liq-panel-expanded')
    return stored === null ? true : stored === 'true'
  })
  const [refreshInterval] = useState(() => {
    const stored = localStorage.getItem('liq-refresh-interval')
    return stored ? parseInt(stored) : DEFAULT_REFRESH
  })
  const [maxDistancePct] = useState(() => {
    const stored = localStorage.getItem('liq-max-distance')
    return stored ? parseFloat(stored) : DEFAULT_MAX_DIST
  })
  const [customFilter, setCustomFilter] = useState('')

  const mountedRef = useRef(true)

  useEffect(() => {
    localStorage.setItem('liq-panel-expanded', String(isExpanded))
  }, [isExpanded])

  useEffect(() => {
    localStorage.setItem('liq-active-filter', activeFilter)
  }, [activeFilter])

  const fetchData = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true)
      try {
        const result = await window.electronAPI?.liquidationFetch({
          maxDistancePct,
        })
        if (!mountedRef.current) return
        if (result?.success && result.positions) {
          setPositions(result.positions)
          setLastUpdated(result.lastUpdated ?? Date.now())
          setError(null)
        } else {
          setError(result?.error ?? 'Failed to fetch')
        }
      } catch (e) {
        console.error('[LiqPanel] fetch error:', e)
        if (mountedRef.current) setError(String(e))
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [maxDistancePct]
  )

  useEffect(() => {
    mountedRef.current = true
    if (isExpanded) fetchData()
    const interval = setInterval(() => {
      if (isExpanded) fetchData(false)
    }, refreshInterval * 1000)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchData, refreshInterval, isExpanded])

  // Get unique tickers from data for the "more" dropdown
  const availableTickers = useMemo(() => {
    const tickers = new Set(positions.map((p) => p.coin))
    return Array.from(tickers).sort()
  }, [positions])

  // Filter positions client-side
  const filtered = useMemo(() => {
    if (activeFilter === 'ALL') return positions
    return positions.filter((p) => p.coin === activeFilter)
  }, [positions, activeFilter])

  const longs = sortPositions(filtered.filter((p) => p.side === 'long'))
  const shorts = sortPositions(filtered.filter((p) => p.side === 'short'))
  const totalLongValue = longs.reduce((s, p) => s + p.positionSize, 0)
  const totalShortValue = shorts.reduce((s, p) => s + p.positionSize, 0)

  const handleCustomFilter = useCallback(() => {
    const coin = customFilter.trim().toUpperCase()
    if (coin) {
      setActiveFilter(coin)
      setCustomFilter('')
      setShowSettings(false)
    }
  }, [customFilter])

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
        aria-label="Toggle whale positions panel"
      >
        <span className="liq-toggle" aria-hidden="true">
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="liq-title">Whale Positions</span>
        {positions.length > 0 && <span className="liq-count">{filtered.length}</span>}
        <button
          className="liq-settings-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowSettings(!showSettings)
          }}
          title="Settings"
          aria-label="Position settings"
        >
          &#x2699;
        </button>
      </div>

      {isExpanded && (
        <div className="liq-panel-content">
          {/* Quick filter chips */}
          {positions.length > 0 && (
            <div className="liq-filters">
              {QUICK_FILTERS.map((f) => (
                <button
                  key={f}
                  className={`liq-filter-chip ${activeFilter === f ? 'active' : ''}`}
                  onClick={() => setActiveFilter(f)}
                >
                  {f}
                </button>
              ))}
              {/* Show active custom filter as a chip if not in quick filters */}
              {activeFilter !== 'ALL' && !QUICK_FILTERS.includes(activeFilter) && (
                <button
                  className="liq-filter-chip active"
                  onClick={() => setActiveFilter('ALL')}
                  title="Click to clear"
                >
                  {activeFilter} &times;
                </button>
              )}
            </div>
          )}

          {showSettings && (
            <div className="liq-settings">
              <label>Filter by ticker</label>
              <div className="liq-settings-row">
                <input
                  type="text"
                  value={customFilter}
                  onChange={(e) => setCustomFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomFilter()
                  }}
                  placeholder="e.g. LINK, AVAX"
                />
                <button className="liq-settings-save" onClick={handleCustomFilter}>
                  Go
                </button>
              </div>
              {availableTickers.length > 0 && (
                <div className="liq-settings-tickers">
                  {availableTickers.map((t) => (
                    <button
                      key={t}
                      className={`liq-ticker-btn ${activeFilter === t ? 'active' : ''}`}
                      onClick={() => {
                        setActiveFilter(t)
                        setShowSettings(false)
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {loading && positions.length === 0 && (
            <div className="liq-loading" role="status">
              Loading whale positions...
            </div>
          )}

          {error && !loading && (
            <div className="liq-error" role="alert">
              {error}
            </div>
          )}

          {!loading && !error && positions.length === 0 && (
            <div className="liq-empty">No whale positions found</div>
          )}

          {filtered.length > 0 && (
            <div className="liq-columns">
              <div className="liq-column liq-column-long">
                <div className="liq-column-header long">
                  {'\u2197'} Longs ({longs.length}) &middot; {formatUsd(totalLongValue)}
                </div>
                <div className="liq-column-list">
                  {longs.map((pos, i) => (
                    <PositionCard key={`${pos.wallet}-${pos.coin}-L-${i}`} pos={pos} />
                  ))}
                  {longs.length === 0 && <div className="liq-column-empty">No longs</div>}
                </div>
              </div>
              <div className="liq-column liq-column-short">
                <div className="liq-column-header short">
                  {'\u2198'} Shorts ({shorts.length}) &middot; {formatUsd(totalShortValue)}
                </div>
                <div className="liq-column-list">
                  {shorts.map((pos, i) => (
                    <PositionCard key={`${pos.wallet}-${pos.coin}-S-${i}`} pos={pos} />
                  ))}
                  {shorts.length === 0 && <div className="liq-column-empty">No shorts</div>}
                </div>
              </div>
            </div>
          )}

          {!loading && !error && positions.length > 0 && filtered.length === 0 && (
            <div className="liq-empty">No {activeFilter} positions found</div>
          )}

          {lastUpdated && (
            <div className="liq-footer">
              <span>Updated {new Date(lastUpdated).toLocaleTimeString()}</span>
              <button
                className="liq-refresh-btn"
                onClick={() => fetchData()}
                title="Refresh now"
                aria-label="Refresh position data"
              >
                {'\u21BB'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
