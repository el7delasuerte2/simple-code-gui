/**
 * Hyperliquid Liquidation Data Fetcher
 *
 * Fetches position data from the public Hyperliquid API and computes
 * which positions are near their liquidation price.
 *
 * Uses two strategies:
 * 1. Static list of known whale wallets
 * 2. Dynamic discovery via leaderboard API
 */
import https from 'https'

const HL_API_URL = 'https://api.hyperliquid.xyz/info'

// Known active whale wallets (public, tracked on CoinGlass/Lookonchain)
const KNOWN_WHALE_WALLETS = [
  '0x5078c2fbea2b2ad61bc840bc023e35fce56bedb6', // James Wynn
  '0x20c2d95a3dfdca9e9ad12794d5fa6fad99da44f5', // @qwatio 50x Brother
  '0x9018960618eff55f5852e345b7cb5661fd2928e1', // @qwatio newer wallet
  '0x2ea18c23f72a4b6172c55b411823cdc5335923f4', // $282M ETH long whale
  '0x7b7b908c076b9784487180de92e7161c2982734e', // BTC/XRP shorts whale
  '0x6c8512516ce5669d35113a11ca8b8de322fd84f6', // ETH Super Bull
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae', // CoinGlass tracked
  '0xb78d97390a96a17fd2b58fedbeb3dd876c8f660a', // Andrew Tate
  '0xa5232e97b4ded3d2ef25be059c3489e61be475aa', // 0xa523 whale
  '0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00', // CoinGlass tracked
]

// Cache leaderboard wallets (refresh every 10 minutes)
let leaderboardCache: { wallets: string[]; timestamp: number } = { wallets: [], timestamp: 0 }
const LEADERBOARD_CACHE_TTL = 10 * 60 * 1000

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

/**
 * Fetch leaderboard wallets from Hyperliquid
 * Returns top traders by PnL who likely have active large positions
 */
async function fetchLeaderboardWallets(): Promise<string[]> {
  const now = Date.now()
  if (leaderboardCache.wallets.length > 0 && now - leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL) {
    return leaderboardCache.wallets
  }

  try {
    // Fetch leaderboard - top traders by performance window
    const result = await postHyperliquid({
      type: 'leaderboard',
      timeWindow: 'day',
    }) as Array<{
      ethAddress: string
      accountValue: string
      windowPerformances: Array<[string, { pnl: string; vlm: string }]>
    }> | { leaderboardRows: Array<{ ethAddress: string; accountValue: string }> }

    let wallets: string[] = []

    if (Array.isArray(result)) {
      // Direct array format
      wallets = result
        .filter((r) => parseFloat(r.accountValue || '0') > 100000) // >$100K accounts
        .slice(0, 50)
        .map((r) => r.ethAddress)
    } else if (result && 'leaderboardRows' in result) {
      // Wrapped format
      wallets = result.leaderboardRows
        .filter((r) => parseFloat(r.accountValue || '0') > 100000)
        .slice(0, 50)
        .map((r) => r.ethAddress)
    }

    if (wallets.length > 0) {
      console.log(`[LiqFetcher] Discovered ${wallets.length} leaderboard wallets`)
      leaderboardCache = { wallets, timestamp: now }
    } else {
      console.log('[LiqFetcher] Leaderboard returned no qualifying wallets')
    }

    return wallets
  } catch (e) {
    console.log('[LiqFetcher] Leaderboard fetch failed (non-critical):', e instanceof Error ? e.message : e)
    return leaderboardCache.wallets // return stale cache if available
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

  // Combine: user wallets + known whales + leaderboard discovery
  const leaderboardWallets = await fetchLeaderboardWallets()
  const allWallets = new Set<string>([
    ...(wallets.length > 0 ? wallets : []),
    ...KNOWN_WHALE_WALLETS,
    ...leaderboardWallets,
  ])
  const walletsToCheck = Array.from(allWallets)
  console.log(`[LiqFetcher] Checking ${walletsToCheck.length} unique wallets (${KNOWN_WHALE_WALLETS.length} known + ${leaderboardWallets.length} leaderboard)`)

  const positions: NearLiqPosition[] = []

  // Fetch in batches of 10 to avoid overwhelming the API
  const BATCH_SIZE = 10
  for (let batch = 0; batch < walletsToCheck.length; batch += BATCH_SIZE) {
    const batchWallets = walletsToCheck.slice(batch, batch + BATCH_SIZE)
    const results = await Promise.allSettled(
      batchWallets.map((wallet) => fetchClearinghouseState(wallet))
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'fulfilled') continue

      const state = result.value
      const wallet = batchWallets[i]
      const shortAddr = wallet.slice(0, 6)

      for (const ap of state.assetPositions || []) {
        const pos = ap.position
        const size = parseFloat(pos.szi)
        if (size === 0) continue

        const coin = pos.coin
        if (coinFilter.length > 0 && !coinFilter.includes(coin)) continue

        const liqPx = pos.liquidationPx ? parseFloat(pos.liquidationPx) : null
        if (!liqPx || liqPx <= 0) continue

        const midStr = mids[coin]
        if (!midStr) continue
        const markPrice = parseFloat(midStr)
        if (markPrice <= 0) continue

        const pctToLiq = (Math.abs(markPrice - liqPx) / markPrice) * 100

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
  }

  // Sort by closest to liquidation first
  positions.sort((a, b) => a.pctToLiquidation - b.pctToLiquidation)

  console.log(`[LiqFetcher] Found ${positions.length} positions within ${maxDistancePct}%`)
  return positions
}
