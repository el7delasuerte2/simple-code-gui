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

        console.log(`[Liquidation] Fetching: ${wallets.length || 'default'} wallets, coins=${coins.length ? coins.join(',') : 'ALL'}, maxDist=${maxDist}%`)
        const positions = await computeNearLiquidations(wallets, maxDist, coins)
        console.log(`[Liquidation] Found ${positions.length} positions near liquidation`)
        return {
          success: true,
          positions,
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
