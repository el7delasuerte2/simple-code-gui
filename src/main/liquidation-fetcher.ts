/**
 * Hyperliquid Position & Liquidation Data Fetcher
 *
 * Fetches position data from the public Hyperliquid API.
 * Dynamically discovers whale wallets from the leaderboard.
 * Focuses on positions NEAR liquidation - the key trading signal.
 *
 * Key metric: "LONGS $5.3M in 2%" = if price drops 2%, $5.3M gets liquidated.
 * This tells you where market makers will push price.
 */
import https from 'https'

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const HL_LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'

// Only include positions that HAVE a liquidation price (skip cross-margin "safe" positions)
// and are within this max distance. Positions 60% away are noise.
const DEFAULT_MAX_DISTANCE_PCT = 15

// Minimum leverage to include
const MIN_LEVERAGE = 3

// Minimum position size ($)
const MIN_POSITION_USD = 1000

// How many leaderboard wallets to check
const LEADERBOARD_TOP_N = 50

// Distance bands for aggregation (percentages)
const BANDS = [1, 2, 3, 5, 10, 15]

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

function postHL(url: string, body: Record<string, unknown> | null): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isPost = body !== null
    const data = isPost ? JSON.stringify(body) : ''

    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: isPost ? 'POST' : 'GET',
        headers: isPost
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
        timeout: 15000,
      },
      (res) => {
        let responseBody = ''
        res.on('data', (chunk: Buffer) => (responseBody += chunk.toString()))
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseBody))
          } catch {
            reject(new Error(`Invalid JSON: ${responseBody.slice(0, 200)}`))
          }
        })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    if (isPost) req.write(data)
    req.end()
  })
}

export async function fetchAllMids(): Promise<Record<string, string>> {
  return (await postHL(HL_INFO_URL, { type: 'allMids' })) as Record<string, string>
}

async function fetchClearinghouseState(wallet: string): Promise<{
  assetPositions: Array<{ position: RawPosition }>
  marginSummary: { accountValue: string }
}> {
  return (await postHL(HL_INFO_URL, {
    type: 'clearinghouseState',
    user: wallet,
  })) as {
    assetPositions: Array<{ position: RawPosition }>
    marginSummary: { accountValue: string }
  }
}

async function fetchLeaderboardWallets(): Promise<string[]> {
  const now = Date.now()
  if (leaderboardCache.wallets.length > 0 && now - leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL) {
    return leaderboardCache.wallets
  }

  try {
    const result = (await postHL(HL_LEADERBOARD_URL, null)) as {
      leaderboardRows: Array<{ ethAddress: string; accountValue: string }>
    }

    const rows = result.leaderboardRows || []
    const wallets = rows
      .filter((r) => parseFloat(r.accountValue || '0') > 500000)
      .slice(0, LEADERBOARD_TOP_N)
      .map((r) => r.ethAddress.toLowerCase())

    console.log(`[LiqFetcher] Leaderboard: ${rows.length} total, ${wallets.length} selected (>$500K, top ${LEADERBOARD_TOP_N})`)
    leaderboardCache = { wallets, timestamp: now }
    return wallets
  } catch (e) {
    console.log('[LiqFetcher] Leaderboard fetch failed:', e instanceof Error ? e.message : e)
    return leaderboardCache.wallets
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
  walletFull: string
  unrealizedPnl: number
}

export interface LiqBands {
  longsByPct: Record<string, number>
  shortsByPct: Record<string, number>
}

export async function computeNearLiquidations(
  wallets: string[],
  maxDistancePct: number,
  coinFilter: string[]
): Promise<{ positions: NearLiqPosition[]; bands: LiqBands }> {
  const effectiveMax = maxDistancePct > 0 ? maxDistancePct : DEFAULT_MAX_DISTANCE_PCT
  const mids = await fetchAllMids()
  console.log(`[LiqFetcher] Got ${Object.keys(mids).length} mid prices`)

  const leaderboardWallets = await fetchLeaderboardWallets()

  const allWallets = new Set<string>([
    ...(wallets.length > 0 ? wallets.map((w) => w.toLowerCase()) : []),
    ...leaderboardWallets,
  ])
  const walletsToCheck = Array.from(allWallets)
  console.log(`[LiqFetcher] Checking ${walletsToCheck.length} wallets (max dist: ${effectiveMax}%)`)

  const positions: NearLiqPosition[] = []

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

        const leverage = pos.leverage?.value || 1
        if (leverage < MIN_LEVERAGE) continue

        const coin = pos.coin
        if (coinFilter.length > 0 && !coinFilter.includes(coin)) continue

        const midStr = mids[coin]
        if (!midStr) continue
        const markPrice = parseFloat(midStr)
        if (markPrice <= 0) continue

        const positionValue = Math.abs(parseFloat(pos.positionValue || '0'))
        if (positionValue < MIN_POSITION_USD) continue

        // CRITICAL: skip positions with no liquidation price (cross-margin, "safe")
        // These are noise - we only want positions that CAN get liquidated
        const liqPx = pos.liquidationPx ? parseFloat(pos.liquidationPx) : null
        if (!liqPx || liqPx <= 0) continue

        const pctToLiq = (Math.abs(markPrice - liqPx) / markPrice) * 100

        // Skip if too far away - not "near liquidation"
        if (pctToLiq > effectiveMax) continue

        positions.push({
          coin,
          positionSize: positionValue,
          leverage,
          liquidationPrice: liqPx,
          markPrice,
          entryPrice: parseFloat(pos.entryPx),
          side: size > 0 ? 'long' : 'short',
          pctToLiquidation: pctToLiq,
          wallet: shortAddr,
          walletFull: wallet,
          unrealizedPnl: parseFloat(pos.unrealizedPnl || '0'),
        })
      }
    }
  }

  // Sort: closest to liquidation first
  positions.sort((a, b) => a.pctToLiquidation - b.pctToLiquidation)

  // Compute aggregated bands: total $ at risk within each distance
  const bands: LiqBands = {
    longsByPct: {},
    shortsByPct: {},
  }
  for (const band of BANDS) {
    bands.longsByPct[String(band)] = positions
      .filter((p) => p.side === 'long' && p.pctToLiquidation <= band)
      .reduce((sum, p) => sum + p.positionSize, 0)
    bands.shortsByPct[String(band)] = positions
      .filter((p) => p.side === 'short' && p.pctToLiquidation <= band)
      .reduce((sum, p) => sum + p.positionSize, 0)
  }

  const nearCount = positions.filter((p) => p.pctToLiquidation <= 5).length
  console.log(`[LiqFetcher] Found ${positions.length} near-liq positions (${nearCount} within 5%), bands computed`)
  console.log(`[LiqFetcher] Longs in 2%: $${(bands.longsByPct['2'] / 1000).toFixed(0)}K | Shorts in 2%: $${(bands.shortsByPct['2'] / 1000).toFixed(0)}K`)
  return { positions, bands }
}
