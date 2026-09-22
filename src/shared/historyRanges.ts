export const HISTORY_COLUMNS = 120
export const SYSTEM_HISTORY_DAYS = 30
/** iStat Menus uses a quarter-hour cadence for the one-day view (96 columns).
 * The other supported views keep the established 120-column cadence. */
export function historyColumns(minutes: number): number {
  return minutes === 1440 ? 96 : HISTORY_COLUMNS
}
export const HISTORY_RANGES = {
  cpu: [10, 60, 180, 360, 720, 1440, 4320, 10080, 20160, 43200],
  memory: [10, 60, 180, 360, 720, 1440, 4320, 10080, 20160, 43200],
  network: [10, 60, 180, 360, 720, 1440, 4320, 10080, 20160, 43200],
  battery: [60, 180, 360, 720, 1440, 4320, 10080]
} as const
export type HistoryKind = keyof typeof HISTORY_RANGES
export function normalizeHistoryRange(kind: HistoryKind, saved: number): number {
  const migrated = kind !== 'battery' && saved === 40320 ? 43200 : saved
  const options: readonly number[] = HISTORY_RANGES[kind]
  return options.includes(migrated) ? migrated : options[0]
}
