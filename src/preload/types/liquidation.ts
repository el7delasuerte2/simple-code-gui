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

export interface LiquidationFetchResult {
  success: boolean
  positions?: LiquidationPosition[]
  error?: string
  lastUpdated?: number
}
