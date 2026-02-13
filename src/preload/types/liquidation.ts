export interface LiquidationPosition {
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

/** Aggregated $ at risk within each distance band */
export interface LiquidationBands {
  longsByPct: Record<string, number>  // e.g. { "1": 500000, "2": 1200000, "5": 8000000 }
  shortsByPct: Record<string, number>
}

export interface LiquidationFetchResult {
  success: boolean
  positions?: LiquidationPosition[]
  bands?: LiquidationBands
  error?: string
  lastUpdated?: number
}
