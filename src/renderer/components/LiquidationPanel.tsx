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
  unrealizedPnl: number
}

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL']
const DEFAULT_REFRESH = 30
const DEFAULT_MAX_DIST = 5

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

export function LiquidationPanel(): React.ReactElement {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showSettings, setShowSettings] = useState(false)

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
  const [watchedCoins, setWatchedCoins] = useState<string[]>(() => {
    const stored = localStorage.getItem('liq-watched-coins')
    try {
      return stored ? JSON.parse(stored) : DEFAULT_COINS
    } catch {
      return DEFAULT_COINS
    }
  })
  const [coinsInput, setCoinsInput] = useState(() => watchedCoins.join(', '))

  const mountedRef = useRef(true)

  useEffect(() => {
    localStorage.setItem('liq-panel-expanded', String(isExpanded))
  }, [isExpanded])

  const fetchData = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true)
      try {
        const result = await window.electronAPI?.liquidationFetch({
          coins: watchedCoins,
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
        if (mountedRef.current) setError(String(e))
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [watchedCoins, maxDistancePct]
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

  const handleSaveCoins = useCallback(() => {
    const coins = coinsInput
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
    setWatchedCoins(coins)
    localStorage.setItem('liq-watched-coins', JSON.stringify(coins))
    setShowSettings(false)
  }, [coinsInput])

  const longsNearLiq = positions.filter((p) => p.side === 'long')
  const shortsNearLiq = positions.filter((p) => p.side === 'short')
  const totalLongValue = longsNearLiq.reduce((s, p) => s + p.positionSize, 0)
  const totalShortValue = shortsNearLiq.reduce((s, p) => s + p.positionSize, 0)

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
        aria-label="Toggle liquidation panel"
      >
        <span className="liq-toggle" aria-hidden="true">
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="liq-title">Near Liquidation</span>
        {positions.length > 0 && <span className="liq-count">{positions.length}</span>}
        <button
          className="liq-settings-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowSettings(!showSettings)
          }}
          title="Settings"
          aria-label="Liquidation settings"
        >
          &#x2699;
        </button>
      </div>

      {isExpanded && (
        <div className="liq-panel-content">
          {showSettings && (
            <div className="liq-settings">
              <label>Coins (comma-separated)</label>
              <input
                type="text"
                value={coinsInput}
                onChange={(e) => setCoinsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCoins()
                }}
                placeholder="BTC, ETH, SOL"
              />
              <button className="liq-settings-save" onClick={handleSaveCoins}>
                Apply
              </button>
            </div>
          )}

          {loading && positions.length === 0 && (
            <div className="liq-loading" role="status">
              Loading...
            </div>
          )}

          {error && !loading && (
            <div className="liq-error" role="alert">
              {error}
            </div>
          )}

          {!loading && !error && positions.length === 0 && (
            <div className="liq-empty">No positions near liquidation</div>
          )}

          {positions.length > 0 && (
            <>
              <div className="liq-summary">
                <span className="liq-summary-long">
                  {'\u2197'} {longsNearLiq.length} longs ({formatUsd(totalLongValue)})
                </span>
                <span className="liq-summary-divider">|</span>
                <span className="liq-summary-short">
                  {'\u2198'} {shortsNearLiq.length} shorts ({formatUsd(totalShortValue)})
                </span>
              </div>

              <div className="liq-positions">
                {positions.map((pos, i) => (
                  <div key={`${pos.wallet}-${pos.coin}-${pos.side}-${i}`} className={`liq-position ${pos.side}`}>
                    <div className="liq-pos-top">
                      <span className={`liq-pos-side ${pos.side}`}>
                        {pos.side === 'long' ? 'L' : 'S'}
                      </span>
                      <span className="liq-pos-coin">{pos.coin}</span>
                      <span className="liq-pos-size">{formatUsd(pos.positionSize)}</span>
                      <span className="liq-pos-leverage">{pos.leverage}x</span>
                      <span
                        className={`liq-pos-distance ${pos.pctToLiquidation < 2 ? 'critical' : pos.pctToLiquidation < 5 ? 'warning' : ''}`}
                      >
                        {pos.pctToLiquidation.toFixed(1)}%
                      </span>
                    </div>
                    <div className="liq-pos-bottom">
                      <span className="liq-pos-wallet">{pos.wallet}</span>
                      <span className="liq-pos-arrow">{'\u2192'}</span>
                      <span className="liq-pos-liq-price">${formatPrice(pos.liquidationPrice)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {lastUpdated && (
            <div className="liq-footer">
              <span>Updated {new Date(lastUpdated).toLocaleTimeString()}</span>
              <button
                className="liq-refresh-btn"
                onClick={() => fetchData()}
                title="Refresh now"
                aria-label="Refresh liquidation data"
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
