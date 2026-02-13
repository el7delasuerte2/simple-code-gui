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
        const wallets = settings.wallets ?? []
        const coins = settings.coins ?? []
        const maxDist = settings.maxDistancePct ?? 10

        const positions = await computeNearLiquidations(wallets, maxDist, coins)
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
