import { ipcMain } from 'electron'
import { computeNearLiquidations, fetchAllMids } from '../liquidation-fetcher.js'

export function registerLiquidationHandlers() {
  ipcMain.handle(
    'liquidation:fetch',
    async (
      _,
      settings: {
        wallets?: string[]
        coins?: string[]
        maxDistancePct?: number
      }
    ) => {
      try {
        const wallets = settings?.wallets ?? []
        const coins = settings?.coins ?? []
        const maxDist = settings?.maxDistancePct ?? 15

        const { positions, bands } = await computeNearLiquidations(wallets, maxDist, coins)
        console.log(`[Liquidation] ${positions.length} near-liq positions | L in 2%: $${(bands.longsByPct['2'] / 1000).toFixed(0)}K | S in 2%: $${(bands.shortsByPct['2'] / 1000).toFixed(0)}K`)
        return {
          success: true,
          positions,
          bands,
          lastUpdated: Date.now(),
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('liquidation:getMids', async () => {
    try {
      const mids = await fetchAllMids()
      return { success: true, mids }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, error: msg }
    }
  })
}
