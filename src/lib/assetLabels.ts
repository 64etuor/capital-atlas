import type { AssetClass, ConfidenceGrade } from '../types/data'

export const ASSET_LABELS: Record<AssetClass, string> = {
  deposits: 'Deposits',
  loans: 'Loans',
  debt_securities: 'Debt securities',
  listed_equity: 'Listed equity',
  unlisted_equity_fdi: 'FDI & unlisted equity',
  funds: 'Funds',
  reserves_gold: 'Reserves & gold',
  residential_property: 'Housing',
  commodities: 'Commodities',
  crypto: 'Crypto',
}

export interface TreemapItem {
  asset: AssetClass
  value: number
  grade: ConfidenceGrade
  fog: number
}
