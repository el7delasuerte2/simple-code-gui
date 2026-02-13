import { ipcRenderer } from 'electron'

export const liquidationHandlers = {
  liquidationFetch: (
    settings?: {
      wallets?: string[]
      coins?: string[]
      maxDistancePct?: number
    }
  ) => ipcRenderer.invoke('liquidation:fetch', settings ?? {}),

  liquidationGetMids: () => ipcRenderer.invoke('liquidation:getMids'),
}
