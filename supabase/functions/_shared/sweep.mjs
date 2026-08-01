// Compatibility shim for callers from #84 (still-clocked-in-close-check, tests).
// Canonical implementation lives in schedule.mjs (date-based findShiftForUser,
// store-close fallback, OUT-before-IN clamp, scheduled grace).
export {
  TZ,
  SYSTEM_AUTO_SWEEP_LABEL,
  AUTO_SWEEP_CLEARED_ACTION,
  STORE_CLOSE_HOUR_WEEKDAY,
  STORE_CLOSE_HOUR_SUNDAY,
  parseShiftTimes,
  getChicagoIsoString,
  getStoreCloseHour,
  getAutoOutIso,
  hasForgottenClockOut,
  isSafeAutoSweepOutInsert,
  findShiftForUser,
  findScheduleDayIndex,
} from './schedule.mjs';
