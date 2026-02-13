/**
 * Hyperliquid Liquidation Data Fetcher
 *
 * Fetches position data from the public Hyperliquid API and computes
 * which positions are near their liquidation price.
 */
import https from 'https'

const HL_API_URL = 'https://api.hyperliquid.xyz/info'

// Well-known active Hyperliquid whale wallets (public, tracked on CoinGlass/Lookonchain)
const DEFAULT_WHALE_WALLETS = [
  '0x5078c2fbea2b2ad61bc840bc023e35fce56bedb6', // James Wynn - massive BTC longs
  '0x20c2d95a3dfdca9e9ad12794d5fa6fad99da44f5', // @qwatio "50x Brother" - ETH shorts
  '0x9018960618eff55f5852e345b7cb5661fd2928e1', // @qwatio newer wallet
  '0x2ea18c23f72a4b6172c55b411823cdc5335923f4', // $282M ETH long whale (Arkham)
  '0x7b7b908c076b9784487180de92e7161c2982734e', // $7M BTC/XRP shorts whale
  '0x6c8512516ce5669d35113a11ca8b8de322fd84f6', // ETH Super Bull - 40k ETH long
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae', // CoinGlass tracked whale
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
  console.log(`[LiqFetcher] Got ${Object.keys(mids).length} mid prices`)

  // Use provided wallets or defaults
  const walletsToCheck = wallets.length > 0 ? wallets : DEFAULT_WHALE_WALLETS
  console.log(`[LiqFetcher] Checking ${walletsToCheck.length} wallets`)

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
