import type {
  DashboardMetrics,
  ExpiryBatch,
  ExpiryStatusInfo,
} from '../types/inventory';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns local calendar date formatted as YYYY-MM-DD without UTC offset bugs.
 */
export function getLocalTodayISO(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Validates and parses YYYY-MM-DD into UTC midnight timestamp for exact calendar day math.
 */
export function parseISODateToDayNumber(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(utcDate.getTime() / MS_PER_DAY);
}

/**
 * Converts YYYY-MM-DD to DD-MM-YYYY for UI tables and Excel exports.
 */
export function formatDisplayDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Parses YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY to canonical YYYY-MM-DD.
 */
export function parseFlexibleDateToISO(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseISODateToDayNumber(trimmed) !== null ? trimmed : null;
  }

  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    const iso = `${year}-${month}-${day}`;
    return parseISODateToDayNumber(iso) !== null ? iso : null;
  }

  return null;
}

/**
 * Calculates calendar days between reference local date and expiryDate.
 * < 0 = already expired, 0 = expires today, > 0 = days remaining.
 */
export function calculateDaysRemaining(
  expiryISO: string,
  referenceISO: string = getLocalTodayISO()
): number {
  const expiryDay = parseISODateToDayNumber(expiryISO);
  const refDay = parseISODateToDayNumber(referenceISO);
  if (expiryDay === null || refDay === null) return 0;
  return expiryDay - refDay;
}

export function classifyExpiryStatus(daysRemaining: number): ExpiryStatusInfo {
  if (daysRemaining < 0) {
    const daysExpired = Math.abs(daysRemaining);
    return {
      severity: 'expired',
      label: daysExpired === 1 ? 'Expired 1d ago' : `Expired ${daysExpired}d ago`,
      daysRemaining,
      badgeTextClass: 'text-red-700',
      badgeBgClass: 'bg-red-50',
      badgeBorderClass: 'border-red-200',
      dotColorClass: 'bg-red-600',
    };
  }

  if (daysRemaining <= 30) {
    return {
      severity: 'critical_30',
      label: daysRemaining === 0 ? 'Expires Today' : `${daysRemaining}d left (0-30d)`,
      daysRemaining,
      badgeTextClass: 'text-orange-700',
      badgeBgClass: 'bg-orange-50',
      badgeBorderClass: 'border-orange-200',
      dotColorClass: 'bg-orange-600',
    };
  }

  if (daysRemaining <= 60) {
    return {
      severity: 'warning_60',
      label: `${daysRemaining}d left (31-60d)`,
      daysRemaining,
      badgeTextClass: 'text-amber-700',
      badgeBgClass: 'bg-amber-50',
      badgeBorderClass: 'border-amber-200',
      dotColorClass: 'bg-amber-500',
    };
  }

  if (daysRemaining <= 90) {
    return {
      severity: 'upcoming_90',
      label: `${daysRemaining}d left (61-90d)`,
      daysRemaining,
      badgeTextClass: 'text-yellow-800',
      badgeBgClass: 'bg-yellow-50',
      badgeBorderClass: 'border-yellow-300',
      dotColorClass: 'bg-yellow-500',
    };
  }

  return {
    severity: 'safe',
    label: `${daysRemaining}d left (>90d)`,
    daysRemaining,
    badgeTextClass: 'text-emerald-700',
    badgeBgClass: 'bg-emerald-50',
    badgeBorderClass: 'border-emerald-200',
    dotColorClass: 'bg-emerald-600',
  };
}

/**
 * Computes all dashboard KPI counts.
 * Note: "Expiring Within 30/60/90 Days" are cumulative buckets (0..30, 0..60, 0..90)
 * while maintaining exact breakdown visibility.
 */
export function computeDashboardMetrics(
  batches: ExpiryBatch[],
  totalMasterProducts: number,
  referenceISO: string = getLocalTodayISO()
): DashboardMetrics {
  const metrics: DashboardMetrics = {
    totalMasterProducts,
    totalExpiryBatches: batches.length,
    totalStockQuantity: 0,
    expiredBatches: 0,
    expiredQuantity: 0,
    within30Batches: 0,
    within30Quantity: 0,
    within60Batches: 0,
    within60Quantity: 0,
    within90Batches: 0,
    within90Quantity: 0,
    safeBatches: 0,
    safeQuantity: 0,
  };

  for (const batch of batches) {
    const qty = Number(batch.quantity) || 0;
    metrics.totalStockQuantity += qty;

    const days = calculateDaysRemaining(batch.expiryDate, referenceISO);
    if (days < 0) {
      metrics.expiredBatches += 1;
      metrics.expiredQuantity += qty;
    } else if (days <= 30) {
      metrics.within30Batches += 1;
      metrics.within30Quantity += qty;
      metrics.within60Batches += 1;
      metrics.within60Quantity += qty;
      metrics.within90Batches += 1;
      metrics.within90Quantity += qty;
    } else if (days <= 60) {
      metrics.within60Batches += 1;
      metrics.within60Quantity += qty;
      metrics.within90Batches += 1;
      metrics.within90Quantity += qty;
    } else if (days <= 90) {
      metrics.within90Batches += 1;
      metrics.within90Quantity += qty;
    } else {
      metrics.safeBatches += 1;
      metrics.safeQuantity += qty;
    }
  }

  return metrics;
}

export function getUpcoming90Batches(
  batches: ExpiryBatch[],
  referenceISO: string = getLocalTodayISO()
): Array<ExpiryBatch & { daysRemaining: number; status: ExpiryStatusInfo }> {
  return batches
    .map((batch) => {
      const daysRemaining = calculateDaysRemaining(batch.expiryDate, referenceISO);
      return {
        ...batch,
        daysRemaining,
        status: classifyExpiryStatus(daysRemaining),
      };
    })
    .filter((item) => item.daysRemaining >= 0 && item.daysRemaining <= 90)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function getExpiredBatches(
  batches: ExpiryBatch[],
  referenceISO: string = getLocalTodayISO()
): Array<ExpiryBatch & { daysExpired: number; daysRemaining: number }> {
  return batches
    .map((batch) => {
      const daysRemaining = calculateDaysRemaining(batch.expiryDate, referenceISO);
      return {
        ...batch,
        daysRemaining,
        daysExpired: Math.abs(daysRemaining),
      };
    })
    .filter((item) => item.daysRemaining < 0)
    .sort((a, b) => b.daysExpired - a.daysExpired); // Oldest expiry first
}
