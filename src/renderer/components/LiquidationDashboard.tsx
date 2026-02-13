/**
 * Full-screen Liquidation Dashboard
 * Opens as an overlay when clicking the sidebar widget.
 * Has full filtering, two-column layout, clickable wallets, ticker watchlist,
 * and a trade configurator that auto-fills when clicking a position.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactDOM from 'react-dom'

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

interface TradeConfig {
  action: 'BUY' | 'SELL'
  coin: string
  leverage: number
  marginPct: number
  ticks: number
  onLiqSide: 'LONG' | 'SHORT'
  onLiqTimeframe: string
  onLiqAmount: number
  specificLiqAction: 'BUY' | 'SELL'
  specificLiqSide: 'LONG' | 'SHORT'
}

interface Bands {
  longsByPct: Record<string, number>
  shortsByPct: Record<string, number>
}

const DEFAULT_REFRESH = 15
const DEFAULT_MAX_DIST = 15
const LEVERAGE_OPTIONS = [1, 5, 10, 20, 40, 50]
const MARGIN_OPTIONS = [0.1, 0.5, 1, 2, 5, 10]
const TICK_OPTIONS = [1, 2, 3, 5, 8, 10, 15]
const TIMEFRAME_OPTIONS = ['10Min', '1H', '4H', '12H', '24H']
const HL_EXPLORER = 'https://app.hyperliquid.xyz/explorer/address/'

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

function DashPositionRow({
  pos,
  isSelected,
  onSelect,
}: {
  pos: Position
  isSelected: boolean
  onSelect: (pos: Position) => void
}): React.ReactElement {
  // MoonDev format: 0x8f BTC $1.8M 40x 0.8% → $68470
  return (
    <div
      className={`ldash-row ${pos.side} ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(pos)}
      style={{ cursor: 'pointer' }}
    >
      <span
        className="ldash-wallet"
        onClick={(e) => {
          e.stopPropagation()
          if (pos.walletFull) window.electronAPI?.openExternal(`${HL_EXPLORER}${pos.walletFull}`)
        }}
        title={pos.walletFull ? `Open ${pos.walletFull}` : pos.wallet}
      >
        {pos.wallet}
      </span>
      <span className="ldash-coin">{pos.coin}</span>
      <span className="ldash-size">{formatUsd(pos.positionSize)}</span>
      <span className="ldash-lev">{pos.leverage}x</span>
      <span className={`ldash-dist ${pos.pctToLiquidation < 2 ? 'critical' : pos.pctToLiquidation < 5 ? 'warning' : ''}`}>
        {pos.pctToLiquidation.toFixed(1)}%
      </span>
      <span className="ldash-arrow">{'\u2192'}</span>
      <span className="ldash-liq-px">${formatPrice(pos.liquidationPrice)}</span>
    </div>
  )
}

function TradeConfigurator({
  config,
  onChange,
  availableCoins,
  liqPrices,
}: {
  config: TradeConfig
  onChange: (c: TradeConfig) => void
  availableCoins: string[]
  liqPrices: number[]
}): React.ReactElement {
  const update = (partial: Partial<TradeConfig>) => onChange({ ...config, ...partial })
  const computedMargin = config.marginPct * config.leverage

  return (
    <div className="ldash-configurator">
      <div className="ldash-config-header">
        <span className="ldash-config-title">Trade Configurator</span>
      </div>

      {/* Row 1: Action + Coin + Leverage */}
      <div className="ldash-config-row">
        <div className="ldash-config-group">
          <button
            className={`ldash-action-btn buy ${config.action === 'BUY' ? 'active' : ''}`}
            onClick={() => update({ action: 'BUY' })}
          >
            BUY
          </button>
          <button
            className={`ldash-action-btn sell ${config.action === 'SELL' ? 'active' : ''}`}
            onClick={() => update({ action: 'SELL' })}
          >
            SELL
          </button>
        </div>
        <div className="ldash-config-group">
          <label className="ldash-config-label">Coin</label>
          <select
            className="ldash-config-select"
            value={config.coin}
            onChange={(e) => update({ coin: e.target.value })}
          >
            {availableCoins.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="ldash-config-group">
          <label className="ldash-config-label">Lev</label>
          <input
            type="number"
            className="ldash-config-input ldash-config-input-sm"
            value={config.leverage}
            min={1}
            max={150}
            onChange={(e) => update({ leverage: parseInt(e.target.value) || 1 })}
          />
        </div>
      </div>

      {/* Row 2: Margin % */}
      <div className="ldash-config-row">
        <label className="ldash-config-label">Margin:</label>
        <div className="ldash-config-chips">
          {MARGIN_OPTIONS.map((m) => (
            <button
              key={m}
              className={`ldash-config-chip ${config.marginPct === m ? 'active' : ''}`}
              onClick={() => update({ marginPct: m })}
            >
              {m}%
            </button>
          ))}
        </div>
        <span className="ldash-config-computed">
          = Margin <strong>${config.marginPct}</strong> {'\u00D7'} <span className="ldash-config-accent">{config.leverage}x</span> = <strong>${computedMargin.toFixed(1)}</strong>
        </span>
      </div>

      {/* Row 3: Ticks */}
      <div className="ldash-config-row">
        <label className="ldash-config-label">Ticks:</label>
        <div className="ldash-config-chips">
          {TICK_OPTIONS.map((t) => (
            <button
              key={t}
              className={`ldash-config-chip ${config.ticks === t ? 'active' : ''}`}
              onClick={() => update({ ticks: t })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Row 4: On Liq Amount */}
      <div className="ldash-config-row">
        <label className="ldash-config-label">On Liq:</label>
        <div className="ldash-config-group">
          <button
            className={`ldash-config-chip-sm ${config.onLiqSide === 'LONG' ? 'active long' : ''}`}
            onClick={() => update({ onLiqSide: 'LONG' })}
          >
            LONG
          </button>
          <button
            className={`ldash-config-chip-sm ${config.onLiqSide === 'SHORT' ? 'active short' : ''}`}
            onClick={() => update({ onLiqSide: 'SHORT' })}
          >
            SHORT
          </button>
        </div>
        <select
          className="ldash-config-select ldash-config-select-sm"
          value={config.onLiqTimeframe}
          onChange={(e) => update({ onLiqTimeframe: e.target.value })}
        >
          {TIMEFRAME_OPTIONS.map((tf) => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>
        <div className="ldash-config-group">
          <span className="ldash-config-label">$</span>
          <input
            type="number"
            className="ldash-config-input"
            value={config.onLiqAmount}
            min={0}
            onChange={(e) => update({ onLiqAmount: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Row 5: @ Specific Liq */}
      <div className="ldash-config-row">
        <label className="ldash-config-label">@ Liq:</label>
        <div className="ldash-config-group">
          <button
            className={`ldash-config-chip-sm ${config.specificLiqAction === 'BUY' ? 'active buy' : ''}`}
            onClick={() => update({ specificLiqAction: 'BUY' })}
          >
            BUY
          </button>
          <button
            className={`ldash-config-chip-sm ${config.specificLiqAction === 'SELL' ? 'active sell' : ''}`}
            onClick={() => update({ specificLiqAction: 'SELL' })}
          >
            SELL
          </button>
        </div>
        <span className="ldash-config-label">upon</span>
        <div className="ldash-config-group">
          <button
            className={`ldash-config-chip-sm ${config.specificLiqSide === 'LONG' ? 'active long' : ''}`}
            onClick={() => update({ specificLiqSide: 'LONG' })}
          >
            LONG
          </button>
          <button
            className={`ldash-config-chip-sm ${config.specificLiqSide === 'SHORT' ? 'active short' : ''}`}
            onClick={() => update({ specificLiqSide: 'SHORT' })}
          >
            SHORT
          </button>
        </div>
        <span className="ldash-config-label">liqs</span>
      </div>

      {/* Select liquidation price */}
      {liqPrices.length > 0 && (
        <div className="ldash-config-row ldash-config-liq-prices">
          <label className="ldash-config-label">Liq prices:</label>
          <div className="ldash-config-liq-scroll">
            {liqPrices.map((px, i) => (
              <button
                key={i}
                className="ldash-config-liq-btn"
                onClick={() => {/* future: set target price */}}
              >
                ${formatPrice(px)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className={`ldash-config-action-bar ${config.action === 'BUY' ? 'buy' : 'sell'}`}>
        <span>
          {config.action} {config.marginPct}% @ Tick {config.ticks} - Click to open {config.action === 'BUY' ? 'long' : 'short'}
        </span>
      </div>
    </div>
  )
}

const DEFAULT_TRADE_CONFIG: TradeConfig = {
  action: 'BUY',
  coin: 'BTC',
  leverage: 5,
  marginPct: 1,
  ticks: 15,
  onLiqSide: 'LONG',
  onLiqTimeframe: '10Min',
  onLiqAmount: 0,
  specificLiqAction: 'BUY',
  specificLiqSide: 'LONG',
}

export function LiquidationDashboard({ onClose }: { onClose: () => void }): React.ReactElement {
  const [positions, setPositions] = useState<Position[]>([])
  const [bands, setBands] = useState<Bands | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const stored = localStorage.getItem('liq-watchlist')
    try { return stored ? JSON.parse(stored) : ['BTC', 'ETH', 'SOL'] } catch { return ['BTC', 'ETH', 'SOL'] }
  })
  const [activeFilter, setActiveFilter] = useState<string>(() => localStorage.getItem('ldash-filter') || 'ALL')
  const [minLeverage, setMinLeverage] = useState<number>(() => {
    const s = localStorage.getItem('ldash-min-lev'); return s ? parseInt(s) : 1
  })
  const [showAddTicker, setShowAddTicker] = useState(false)
  const [tickerSearch, setTickerSearch] = useState('')
  const tickerInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)

  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [tradeConfig, setTradeConfig] = useState<TradeConfig>(() => {
    const stored = localStorage.getItem('ldash-trade-config')
    try { return stored ? { ...DEFAULT_TRADE_CONFIG, ...JSON.parse(stored) } : DEFAULT_TRADE_CONFIG } catch { return DEFAULT_TRADE_CONFIG }
  })
  const [activeTab, setActiveTab] = useState<string>('actions')

  useEffect(() => { localStorage.setItem('ldash-filter', activeFilter) }, [activeFilter])
  useEffect(() => { localStorage.setItem('ldash-min-lev', String(minLeverage)) }, [minLeverage])
  useEffect(() => { localStorage.setItem('liq-watchlist', JSON.stringify(watchlist)) }, [watchlist])
  useEffect(() => { localStorage.setItem('ldash-trade-config', JSON.stringify(tradeConfig)) }, [tradeConfig])
  useEffect(() => {
    if (showAddTicker) setTimeout(() => tickerInputRef.current?.focus(), 50)
  }, [showAddTicker])

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const result = await window.electronAPI?.liquidationFetch({ maxDistancePct: DEFAULT_MAX_DIST })
      if (!mountedRef.current) return
      if (result?.success) {
        setPositions(result.positions || [])
        setBands(result.bands || null)
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
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    const interval = setInterval(() => fetchData(false), DEFAULT_REFRESH * 1000)
    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [fetchData])

  const availableTickers = useMemo(() => {
    return Array.from(new Set(positions.map((p) => p.coin))).sort()
  }, [positions])

  const tickerSuggestions = useMemo(() => {
    const s = tickerSearch.toUpperCase()
    return availableTickers.filter((t) => !watchlist.includes(t) && (s === '' || t.includes(s))).slice(0, 30)
  }, [availableTickers, watchlist, tickerSearch])

  const filtered = useMemo(() => {
    return positions.filter((p) => {
      if (activeFilter !== 'ALL' && p.coin !== activeFilter) return false
      if (p.leverage < minLeverage) return false
      return true
    })
  }, [positions, activeFilter, minLeverage])

  const longs = sortPositions(filtered.filter((p) => p.side === 'long'))
  const shorts = sortPositions(filtered.filter((p) => p.side === 'short'))
  const totalLongVal = longs.reduce((s, p) => s + p.positionSize, 0)
  const totalShortVal = shorts.reduce((s, p) => s + p.positionSize, 0)

  const addTicker = useCallback((t: string) => {
    const coin = t.toUpperCase()
    if (coin && !watchlist.includes(coin)) setWatchlist((prev) => [...prev, coin])
    setActiveFilter(coin)
    setShowAddTicker(false)
    setTickerSearch('')
  }, [watchlist])

  const removeTicker = useCallback((t: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setWatchlist((prev) => prev.filter((x) => x !== t))
    if (activeFilter === t) setActiveFilter('ALL')
  }, [activeFilter])

  const handleSelectPosition = useCallback((pos: Position) => {
    setSelectedPos(pos)
    // Auto-fill trade configurator from position
    setTradeConfig((prev) => ({
      ...prev,
      coin: pos.coin,
      leverage: pos.leverage,
      action: pos.side === 'long' ? 'SELL' : 'BUY', // trade against the liquidation
      onLiqSide: pos.side === 'long' ? 'LONG' : 'SHORT',
      specificLiqSide: pos.side === 'long' ? 'LONG' : 'SHORT',
      specificLiqAction: pos.side === 'long' ? 'BUY' : 'SELL',
    }))
  }, [])

  // Band display data
  const BAND_KEYS = ['1', '2', '3', '5', '10', '15']

  // Extract unique liq prices for the selected coin, sorted, for the configurator
  const liqPricesForCoin = useMemo(() => {
    const coin = tradeConfig.coin
    const prices = filtered
      .filter((p) => p.coin === coin && p.liquidationPrice > 0)
      .map((p) => p.liquidationPrice)
    // Round and dedupe
    const unique = Array.from(new Set(prices.map((p) => Math.round(p * 100) / 100)))
    return unique.sort((a, b) => b - a).slice(0, 15)
  }, [filtered, tradeConfig.coin])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return ReactDOM.createPortal(
    <div className="ldash-overlay">
      <div className="ldash-container">
        {/* Header */}
        <div className="ldash-header">
          <h2 className="ldash-title">Whale Positions Dashboard</h2>
          <div className="ldash-header-right">
            {lastUpdated && (
              <span className="ldash-updated">
                Updated {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <button className="ldash-refresh" onClick={() => fetchData()} title="Refresh">
              {'\u21BB'}
            </button>
            <button className="ldash-close" onClick={onClose} title="Close (Esc)">
              &times;
            </button>
          </div>
        </div>

        {/* Ticker bar */}
        <div className="ldash-filters">
          <div className="ldash-ticker-bar">
            <button
              className={`ldash-chip ${activeFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setActiveFilter('ALL')}
            >
              ALL ({positions.length})
            </button>
            {watchlist.map((t) => {
              const count = positions.filter((p) => p.coin === t).length
              return (
                <button
                  key={t}
                  className={`ldash-chip ${activeFilter === t ? 'active' : ''}`}
                  onClick={() => setActiveFilter(t)}
                >
                  {t} {count > 0 && <span className="ldash-chip-count">({count})</span>}
                  <span className="ldash-chip-x" onClick={(e) => removeTicker(t, e)}>&times;</span>
                </button>
              )
            })}
            <button className="ldash-chip ldash-chip-add" onClick={() => setShowAddTicker(!showAddTicker)}>+</button>
          </div>

          {showAddTicker && (
            <div className="ldash-add-popup">
              <input
                ref={tickerInputRef}
                type="text"
                value={tickerSearch}
                onChange={(e) => setTickerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tickerSearch.trim()) addTicker(tickerSearch.trim())
                  if (e.key === 'Escape') setShowAddTicker(false)
                }}
                placeholder="Search ticker..."
                className="ldash-search-input"
              />
              <div className="ldash-ticker-grid">
                {tickerSuggestions.map((t) => (
                  <button key={t} className="ldash-ticker-opt" onClick={() => addTicker(t)}>{t}</button>
                ))}
              </div>
            </div>
          )}

          {/* Leverage filter */}
          <div className="ldash-lev-bar">
            <span className="ldash-lev-label">Min leverage:</span>
            {LEVERAGE_OPTIONS.map((lev) => (
              <button
                key={lev}
                className={`ldash-chip ldash-chip-sm ${minLeverage === lev ? 'active' : ''}`}
                onClick={() => setMinLeverage(lev)}
              >
                {lev}x+
              </button>
            ))}
          </div>
        </div>

        {/* Summary bar with aggregated volume */}
        {filtered.length > 0 && (
          <div className="ldash-summary">
            <div className="ldash-summary-item long">
              {'\u2197'} {longs.length} Longs &middot; {formatUsd(totalLongVal)}
            </div>
            <div className="ldash-summary-item short">
              {'\u2198'} {shorts.length} Shorts &middot; {formatUsd(totalShortVal)}
            </div>
            <div className="ldash-summary-item total">
              {filtered.length} positions shown
            </div>
          </div>
        )}

        {/* Liquidation bands - THE key signal */}
        {bands && (
          <div className="ldash-bands">
            <div className="ldash-bands-row ldash-bands-header">
              <span className="ldash-bands-label">Dist</span>
              {BAND_KEYS.map((k) => (
                <span key={k} className="ldash-bands-cell">{k}%</span>
              ))}
            </div>
            <div className="ldash-bands-row ldash-bands-long">
              <span className="ldash-bands-label">{'\u2197'} Longs</span>
              {BAND_KEYS.map((k) => {
                const val = bands.longsByPct[k] ?? 0
                return <span key={k} className={`ldash-bands-cell ${val > 0 ? 'has-value' : ''}`}>{val > 0 ? formatUsd(val) : '-'}</span>
              })}
            </div>
            <div className="ldash-bands-row ldash-bands-short">
              <span className="ldash-bands-label">{'\u2198'} Shorts</span>
              {BAND_KEYS.map((k) => {
                const val = bands.shortsByPct[k] ?? 0
                return <span key={k} className={`ldash-bands-cell ${val > 0 ? 'has-value' : ''}`}>{val > 0 ? formatUsd(val) : '-'}</span>
              })}
            </div>
          </div>
        )}

        {/* Content: positions + configurator side by side */}
        <div className="ldash-body">
          {loading && positions.length === 0 && (
            <div className="ldash-status">Loading whale positions...</div>
          )}
          {error && !loading && (
            <div className="ldash-status ldash-error">{error}</div>
          )}

          {filtered.length > 0 && (
            <div className="ldash-main-content">
              {/* Left: position columns */}
              <div className="ldash-positions-area">
                <div className="ldash-columns">
                  <div className="ldash-col">
                    <div className="ldash-col-header long">
                      {'\u2197'} Longs Near Liq ({formatUsd(bands?.longsByPct?.['2'] ?? 0)} in 2%)
                    </div>
                    {longs.map((pos, i) => (
                      <DashPositionRow
                        key={`L-${pos.wallet}-${pos.coin}-${i}`}
                        pos={pos}
                        isSelected={selectedPos === pos}
                        onSelect={handleSelectPosition}
                      />
                    ))}
                    {longs.length === 0 && <div className="ldash-empty">No longs near liq</div>}
                  </div>
                  <div className="ldash-col">
                    <div className="ldash-col-header short">
                      {'\u2198'} Shorts Near Liq ({formatUsd(bands?.shortsByPct?.['2'] ?? 0)} in 2%)
                    </div>
                    {shorts.map((pos, i) => (
                      <DashPositionRow
                        key={`S-${pos.wallet}-${pos.coin}-${i}`}
                        pos={pos}
                        isSelected={selectedPos === pos}
                        onSelect={handleSelectPosition}
                      />
                    ))}
                    {shorts.length === 0 && <div className="ldash-empty">No shorts near liq</div>}
                  </div>
                </div>
              </div>

              {/* Right: trade configurator */}
              <div className="ldash-config-area">
                <div className="ldash-tabs">
                  {['actions', 'position', 'risk', 'log'].map((tab) => (
                    <button
                      key={tab}
                      className={`ldash-tab ${activeTab === tab ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {activeTab === 'actions' && (
                  <TradeConfigurator
                    config={tradeConfig}
                    onChange={setTradeConfig}
                    availableCoins={availableTickers.length > 0 ? availableTickers : ['BTC', 'ETH', 'SOL']}
                    liqPrices={liqPricesForCoin}
                  />
                )}

                {activeTab === 'position' && (
                  <div className="ldash-tab-content">
                    {selectedPos ? (
                      <div className="ldash-pos-detail">
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Coin</span>
                          <span className="ldash-pos-detail-value">{selectedPos.coin}</span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Side</span>
                          <span className={`ldash-pos-detail-value ${selectedPos.side}`}>
                            {selectedPos.side.toUpperCase()}
                          </span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Size</span>
                          <span className="ldash-pos-detail-value">{formatUsd(selectedPos.positionSize)}</span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Leverage</span>
                          <span className="ldash-pos-detail-value">{selectedPos.leverage}x</span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Entry</span>
                          <span className="ldash-pos-detail-value">${formatPrice(selectedPos.entryPrice)}</span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Mark</span>
                          <span className="ldash-pos-detail-value">${formatPrice(selectedPos.markPrice)}</span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Liq Price</span>
                          <span className="ldash-pos-detail-value">
                            {selectedPos.liquidationPrice > 0 ? `$${formatPrice(selectedPos.liquidationPrice)}` : 'N/A'}
                          </span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Dist to Liq</span>
                          <span className={`ldash-pos-detail-value ${selectedPos.pctToLiquidation < 5 ? 'warning' : ''}`}>
                            {selectedPos.pctToLiquidation >= 0 ? `${selectedPos.pctToLiquidation.toFixed(2)}%` : 'safe'}
                          </span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">PnL</span>
                          <span className={`ldash-pos-detail-value ${selectedPos.unrealizedPnl >= 0 ? 'profit' : 'loss'}`}>
                            {formatPnl(selectedPos.unrealizedPnl)}
                          </span>
                        </div>
                        <div className="ldash-pos-detail-row">
                          <span className="ldash-pos-detail-label">Wallet</span>
                          <span
                            className="ldash-pos-detail-value ldash-pos-detail-wallet"
                            onClick={() => {
                              if (selectedPos.walletFull) window.electronAPI?.openExternal(`${HL_EXPLORER}${selectedPos.walletFull}`)
                            }}
                          >
                            {selectedPos.walletFull || selectedPos.wallet}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="ldash-tab-placeholder">Click a position to view details</div>
                    )}
                  </div>
                )}

                {activeTab === 'risk' && (
                  <div className="ldash-tab-content">
                    <div className="ldash-tab-placeholder">Risk management (coming soon)</div>
                  </div>
                )}

                {activeTab === 'log' && (
                  <div className="ldash-tab-content">
                    <div className="ldash-tab-placeholder">Trade log (coming soon)</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && !error && positions.length > 0 && filtered.length === 0 && (
            <div className="ldash-status">No {activeFilter !== 'ALL' ? activeFilter : ''} positions with {minLeverage}x+ leverage</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
