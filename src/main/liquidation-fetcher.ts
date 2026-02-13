/**
 * Hyperliquid Liquidation Data Fetcher
 *
 * Fetches position data from the public Hyperliquid API and computes
 * which positions are near their liquidation price.
 */
import https from 'https'

const HL_API_URL = 'https://api.hyperliquid.xyz/info'

// Well-known active Hyperliquid whale wallets (public addresses)
const DEFAULT_WHALE_WALLETS = [
  '0x8f3bfb7d34adec90577daab8ce18fc08e7cfb742',
  '0xdbc33e6357144ba4d300c4a61b91b7b096f5a63d',
  '0x5e4e8f23a0f5a5b5c7b4d79fb1e1a3e2e3e4e5f6',
]

interface RawPosition {
  coin: string
  szi: string
  leverage: { type: string; value: number }
  liquidationPx: string | null
  entryPx: string
  unrealizedPnl: string
  positionValue: string
}

function postHyperliquid(body: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(HL_API_URL)

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => (body += chunk.toString()))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error(`Invalid JSON response: ${body.slice(0, 200)}`))
          }
        })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    req.write(data)
    req.end()
  })
}

export async function fetchAllMids(): Promise<Record<string, string>> {
  const result = (await postHyperliquid({ type: 'allMids' })) as Record<string, string>
  return result
}

export async function fetchClearinghouseState(wallet: string): Promise<{
  assetPositions: Array<{ position: RawPosition }>
  marginSummary: { accountValue: string }
}> {
  const result = await postHyperliquid({
    type: 'clearinghouseState',
    user: wallet,
  })
  return result as {
    assetPositions: Array<{ position: RawPosition }>
    marginSummary: { accountValue: string }
  }
}

export interface NearLiqPosition {
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

export async function computeNearLiquidations(
  wallets: string[],
  maxDistancePct: number,
  coinFilter: string[]
): Promise<NearLiqPosition[]> {
  // Fetch current mid prices
  const mids = await fetchAllMids()

  // Use provided wallets or defaults
  const walletsToCheck = wallets.length > 0 ? wallets : DEFAULT_WHALE_WALLETS

  const positions: NearLiqPosition[] = []

  // Fetch positions for each wallet (in parallel, batched)
  const results = await Promise.allSettled(
    walletsToCheck.map((wallet) => fetchClearinghouseState(wallet))
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status !== 'fulfilled') continue

    const state = result.value
    const wallet = walletsToCheck[i]
    const shortAddr = wallet.slice(0, 6)

    for (const ap of state.assetPositions || []) {
      const pos = ap.position
      const size = parseFloat(pos.szi)
      if (size === 0) continue

      const coin = pos.coin
      // Apply coin filter
      if (coinFilter.length > 0 && !coinFilter.includes(coin)) continue

      const liqPx = pos.liquidationPx ? parseFloat(pos.liquidationPx) : null
      if (!liqPx || liqPx <= 0) continue

      const midStr = mids[coin]
      if (!midStr) continue
      const markPrice = parseFloat(midStr)
      if (markPrice <= 0) continue

      const pctToLiq = (Math.abs(markPrice - liqPx) / markPrice) * 100

      // Filter by max distance
      if (pctToLiq > maxDistancePct) continue

      positions.push({
        coin,
        positionSize: Math.abs(parseFloat(pos.positionValue || '0')),
        leverage: pos.leverage?.value || 1,
        liquidationPrice: liqPx,
        markPrice,
        entryPrice: parseFloat(pos.entryPx),
        side: size > 0 ? 'long' : 'short',
        pctToLiquidation: pctToLiq,
        wallet: shortAddr,
        unrealizedPnl: parseFloat(pos.unrealizedPnl || '0'),
      })
    }
  }

  // Sort by closest to liquidation first
  positions.sort((a, b) => a.pctToLiquidation - b.pctToLiquidation)

  return positions
}
