import * as lightningPayReq from 'light-bolt11-decoder';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import type { 
  ZapReceipt, 
  ParsedZap, 
  EarningsByPeriod, 
  EarningsByContent, 
  EarningsByKind, 
  ZapperStats,
  TimeRange,
  CustomDateRange
} from '@/types/zaplytics';
import { TIME_RANGES, KIND_NAMES } from '@/types/zaplytics';

/**
 * Parse a Lightning invoice to extract the amount in sats
 */
export function parseBolt11Amount(bolt11: string): number {
  try {
    const decoded = (lightningPayReq as unknown as { decode: (bolt11: string) => { sections: { name: string; value: string | number }[] } }).decode(bolt11);
    const amountSection = decoded.sections.find((section) => section.name === 'amount');
    if (amountSection && amountSection.value) {
      // Convert from millisats to sats
      return Math.floor(Number(amountSection.value) / 1000);
    }
  } catch (error) {
    console.warn('Failed to decode bolt11:', error);
  }
  return 0;
}

/**
 * Parse a zap receipt event into a structured format
 */
export function parseZapReceipt(zapEvent: ZapReceipt): ParsedZap | null {
  try {
    // Extract bolt11 from tags
    const bolt11Tag = zapEvent.tags.find(tag => tag[0] === 'bolt11');
    if (!bolt11Tag || !bolt11Tag[1]) return null;

    const amount = parseBolt11Amount(bolt11Tag[1]);
    if (amount === 0) return null;

    // Extract zapped event info
    const eTag = zapEvent.tags.find(tag => tag[0] === 'e');
    const pTag = zapEvent.tags.find(tag => tag[0] === 'p');
    
    // Extract zap request if present
    const zapRequestDesc = zapEvent.tags.find(tag => tag[0] === 'description');
    let zapRequest: ParsedZap['zapRequest'] | undefined;
    let comment: string | undefined;

    if (zapRequestDesc && zapRequestDesc[1]) {
      try {
        const zapRequestEvent = JSON.parse(zapRequestDesc[1]);
        zapRequest = {
          pubkey: zapRequestEvent.pubkey,
          content: zapRequestEvent.content,
          created_at: zapRequestEvent.created_at,
        };
        comment = zapRequestEvent.content || undefined;
      } catch (error) {
        console.warn('Failed to parse zap request:', error);
      }
    }

    const parsedZap: ParsedZap = {
      receipt: zapEvent,
      amount,
      comment,
      zapRequest,
      zapper: {
        pubkey: zapRequest?.pubkey || zapEvent.pubkey,
        anonymous: !zapRequest,
      },
    };

    if (eTag && eTag[1]) {
      parsedZap.zappedEvent = {
        id: eTag[1],
        kind: 1, // Default to kind 1, will be updated when we fetch the actual event
        author: pTag?.[1] || '',
        content: '',
        created_at: 0,
      };
    }

    return parsedZap;
  } catch (error) {
    console.warn('Failed to parse zap receipt:', error);
    return null;
  }
}

/**
 * Validate if an event is a proper zap receipt
 */
export function isValidZapReceipt(event: NostrEvent): event is ZapReceipt {
  if (event.kind !== 9735) return false;
  
  // Must have bolt11 tag
  const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
  if (!bolt11Tag || !bolt11Tag[1]) return false;
  
  // Must have valid amount
  const amount = parseBolt11Amount(bolt11Tag[1]);
  return amount > 0;
}

// Custom-range contract: a Date at local midnight is a picker calendar
// date; anything else is a precise timestamp (rolling windows, "now").
// Bounds semantics — `since` is the `from` instant (a calendar `from` is
// already its day's start); `until` is the `to` instant, expanded to the
// last second of its day only when `to` is a calendar date so the picker's
// end day counts without pushing rolling windows into the future.
const isMidnightLocal = (d: Date): boolean =>
  d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;

const startOfLocalDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const endOfLocalDay = (d: Date): Date =>
  new Date(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1);

/**
 * Get date range for a time period
 */
export function getDateRange(timeRange: TimeRange, customRange?: CustomDateRange): { since: number; until?: number } {
  if (timeRange === 'custom' && customRange) {
    const since = Math.floor(
      (isMidnightLocal(customRange.from) ? startOfLocalDay(customRange.from) : customRange.from).getTime() / 1000,
    );
    const until = Math.floor(
      (isMidnightLocal(customRange.to) ? endOfLocalDay(customRange.to) : customRange.to).getTime() / 1000,
    );
    return { since, until };
  }
  
  const config = TIME_RANGES[timeRange];
  const now = Math.floor(Date.now() / 1000);
  
  if (config.days === null) {
    // All time - no since filter
    return { since: 0 };
  }
  
  const since = now - (config.days * 24 * 60 * 60);
  return { since, until: now };
}

/**
 * Group zaps by time period
 */
export function groupZapsByPeriod(zaps: ParsedZap[], timeRange: TimeRange, customRange?: CustomDateRange): EarningsByPeriod[] {
  const config = TIME_RANGES[timeRange];
  const grouped = new Map<string, { totalSats: number; zapCount: number; date: Date }>();

  // For custom ranges, determine appropriate grouping based on range length
  let groupBy = config.groupBy;
  if (timeRange === 'custom' && customRange) {
    const daysDiff = Math.ceil((customRange.to.getTime() - customRange.from.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 2) {
      groupBy = 'hour';
    } else if (daysDiff <= 31) {
      groupBy = 'day';
    } else if (daysDiff <= 90) {
      groupBy = 'week';
    } else {
      groupBy = 'month';
    }
  }

  // Helper: get the period key and start date for a given Date.
  // Everything is UTC — keys are toISOString()-derived, and using local
  // components for periodDate produced buckets whose key and date
  // disagreed off-UTC (duplicated/misaligned chart entries).
  const getPeriod = (date: Date): { key: string; periodDate: Date } => {
    switch (groupBy) {
      case 'hour':
        return {
          key: date.toISOString().slice(0, 13) + ':00:00.000Z',
          periodDate: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours())),
        };
      case 'day':
        return {
          key: date.toISOString().slice(0, 10),
          periodDate: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
        };
      case 'week': {
        const weekStart = new Date(date);
        weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
        return {
          key: weekStart.toISOString().slice(0, 10),
          periodDate: new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate())),
        };
      }
      case 'month':
        return {
          key: date.toISOString().slice(0, 7),
          periodDate: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
        };
      default:
        return {
          key: date.toISOString().slice(0, 10),
          periodDate: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
        };
    }
  };

  zaps.forEach(zap => {
    const date = new Date(zap.receipt.created_at * 1000);
    const { key: periodKey, periodDate } = getPeriod(date);

    const existing = grouped.get(periodKey) || { totalSats: 0, zapCount: 0, date: periodDate };
    existing.totalSats += zap.amount;
    existing.zapCount += 1;
    grouped.set(periodKey, existing);
  });

  // Fill in gaps with zero-earning periods so the chart shows a continuous
  // timeline. Without this, months/weeks/days with no zaps are simply missing
  // from the chart, making it look like time jumped (e.g. Jan '25 → Mar '26).
  // We determine the full range from the time range config + actual data.
  const filled = fillPeriodGaps(grouped, groupBy, timeRange, customRange);

  return Array.from(filled.entries())
    .map(([period, stats]) => ({
      period,
      ...stats,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Fill in missing periods with zero-earning entries so the chart shows
 * a continuous timeline from the first period to the last.
 */
function fillPeriodGaps(
  grouped: Map<string, { totalSats: number; zapCount: number; date: Date }>,
  groupBy: 'hour' | 'day' | 'week' | 'month',
  timeRange: TimeRange,
  customRange?: CustomDateRange,
): Map<string, { totalSats: number; zapCount: number; date: Date }> {
  if (grouped.size === 0) return grouped;

  // Determine the start and end of the range to fill
  let rangeStart: Date;
  let rangeEnd: Date;

  if (timeRange === 'custom' && customRange) {
    rangeStart = isMidnightLocal(customRange.from) ? startOfLocalDay(customRange.from) : customRange.from;
    // Calendar dates (midnight-local `to`) fill through the last instant of
    // the end day; precise `to` values (rolling windows) stay exact —
    // expanding those could project the chart into a future UTC day.
    rangeEnd = isMidnightLocal(customRange.to) ? endOfLocalDay(customRange.to) : customRange.to;
  } else if (timeRange === 'all') {
    // For all-time, use the oldest and newest zap dates
    const dates = Array.from(grouped.values()).map(g => g.date);
    rangeStart = new Date(Math.min(...dates.map(d => d.getTime())));
    rangeEnd = new Date(); // now
  } else {
    // For preset ranges (24h, 7d), use the time range boundary
    const config = TIME_RANGES[timeRange];
    rangeEnd = new Date();
    rangeStart = new Date(rangeEnd.getTime() - (config.days || 7) * 24 * 60 * 60 * 1000);
  }

  // Snap rangeStart to the beginning of its period
  const snappedStart = snapToPeriodStart(rangeStart, groupBy);

  // Iterate from snappedStart to rangeEnd, creating zero entries for missing periods
  let current = new Date(snappedStart);
  while (current <= rangeEnd) {
    let key: string;
    let periodDate: Date;

    switch (groupBy) {
      case 'hour':
        key = current.toISOString().slice(0, 13) + ':00:00.000Z';
        periodDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), current.getUTCHours()));
        current = new Date(current.getTime() + 60 * 60 * 1000); // +1 hour
        break;
      case 'day':
        key = current.toISOString().slice(0, 10);
        periodDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1)); // +1 day
        break;
      case 'week': {
        const weekStart = new Date(current);
        weekStart.setUTCDate(current.getUTCDate() - current.getUTCDay());
        key = weekStart.toISOString().slice(0, 10);
        periodDate = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate()));
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 7)); // +1 week
        break;
      }
      case 'month':
        key = current.toISOString().slice(0, 7);
        periodDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)); // +1 month
        break;
      default:
        key = current.toISOString().slice(0, 10);
        periodDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
        current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1));
    }

    if (!grouped.has(key)) {
      grouped.set(key, { totalSats: 0, zapCount: 0, date: periodDate });
    }
  }

  return grouped;
}

/** Snap a date to the start of its period (e.g. first day of month for 'month'). */
function snapToPeriodStart(date: Date, groupBy: 'hour' | 'day' | 'week' | 'month'): Date {
  switch (groupBy) {
    case 'hour':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
    case 'day':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    case 'week': {
      const d = new Date(date);
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    case 'month':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    default:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}

/**
 * Group zaps by content/event
 */
export function groupZapsByContent(zaps: ParsedZap[]): EarningsByContent[] {
  const grouped = new Map<string, EarningsByContent>();

  zaps.forEach(zap => {
    if (!zap.zappedEvent) return;
    // Skip entries where the zapped event wasn't actually fetched
    // (empty content + epoch date means we only have the event ID from the e tag)
    if (!zap.zappedEvent.content && zap.zappedEvent.created_at === 0) return;

    const existing = grouped.get(zap.zappedEvent.id);
    if (existing) {
      existing.totalSats += zap.amount;
      existing.zapCount += 1;
    } else {
      grouped.set(zap.zappedEvent.id, {
        eventId: zap.zappedEvent.id,
        eventKind: zap.zappedEvent.kind,
        content: zap.zappedEvent.content || '',
        author: zap.zappedEvent.author,
        totalSats: zap.amount,
        zapCount: 1,
        created_at: zap.zappedEvent.created_at,
      });
    }
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.totalSats - a.totalSats);
}

/**
 * Group zaps by event kind
 */
export function groupZapsByKind(zaps: ParsedZap[]): EarningsByKind[] {
  const grouped = new Map<number, { totalSats: number; zapCount: number }>();
  let totalSats = 0;

  zaps.forEach(zap => {
    if (!zap.zappedEvent) return;
    // Skip zaps whose event was never fetched — they're e-tag stubs that
    // default to kind 1 and would inflate that bucket (same guard as
    // groupZapsByContent). Counting only attributed zaps also keeps the
    // percentages summing to 100.
    if (!zap.zappedEvent.content && zap.zappedEvent.created_at === 0) return;

    totalSats += zap.amount;
    const kind = zap.zappedEvent.kind;
    const existing = grouped.get(kind) || { totalSats: 0, zapCount: 0 };
    existing.totalSats += zap.amount;
    existing.zapCount += 1;
    grouped.set(kind, existing);
  });

  return Array.from(grouped.entries())
    .map(([kind, stats]) => ({
      kind,
      kindName: KIND_NAMES[kind] || `Kind ${kind}`,
      totalSats: stats.totalSats,
      zapCount: stats.zapCount,
      percentage: totalSats > 0 ? (stats.totalSats / totalSats) * 100 : 0,
    }))
    .sort((a, b) => b.totalSats - a.totalSats);
}

/**
 * Get top zappers stats
 */
export function getTopZappers(zaps: ParsedZap[]): ZapperStats[] {
  const grouped = new Map<string, ZapperStats>();

  zaps.forEach(zap => {
    // Anonymous zaps (no zap request in the receipt) would otherwise credit
    // the LNURL server's key — group them under one labeled bucket instead.
    const key = zap.zapper.anonymous ? '__anonymous__' : zap.zapper.pubkey;
    const existing = grouped.get(key);
    if (existing) {
      existing.totalSats += zap.amount;
      existing.zapCount += 1;
    } else {
      grouped.set(key, {
        pubkey: key,
        name: zap.zapper.anonymous ? 'Anonymous' : zap.zapper.name,
        // Anonymous bucket gets only aggregate counts + a neutral label —
        // propagating the LNURL server's nip05/picture would dress a
        // service's profile up as the unknown sender.
        ...(zap.zapper.anonymous ? { anonymous: true } : {
          nip05: zap.zapper.nip05,
          picture: zap.zapper.picture,
        }),
        totalSats: zap.amount,
        zapCount: 1,
      });
    }
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.totalSats - a.totalSats);
}

/**
 * Format sats amount with proper thousands separators
 */
export function formatSats(sats: number): string {
  return sats.toLocaleString();
}

/**
 * Format percentage to 1 decimal place
 */
export function formatPercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}

/**
 * Create njump links for events and profiles
 */
export function createNjumpEventLink(eventId: string): string {
  try {
    const nevent = nip19.noteEncode(eventId);
    return `https://njump.me/${nevent}`;
  } catch {
    return `https://njump.me/${eventId}`;
  }
}

export function createNjumpProfileLink(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `https://njump.me/${npub}`;
  } catch {
    return `https://njump.me/${pubkey}`;
  }
}

/**
 * Truncate text to specified length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Extract URLs from text content.
 * Returns an array of { url, type } where type is 'image' | 'video' | 'link'.
 */
export function extractUrls(text: string): { url: string; type: 'image' | 'video' | 'link'; domain: string }[] {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const matches: { url: string; type: 'image' | 'video' | 'link'; domain: string }[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);

    const lowerUrl = url.toLowerCase();
    let type: 'image' | 'video' | 'link' = 'link';

    // Check for image extensions
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|#|$)/i.test(lowerUrl)) {
      type = 'image';
    }
    // Check for video extensions
    else if (/\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i.test(lowerUrl)) {
      type = 'video';
    }

    // Extract domain
    let domain = '';
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      domain = url.substring(0, 30);
    }

    matches.push({ url, type, domain });
  }

  return matches;
}

/**
 * Get text content with URLs removed (for cleaner preview text).
 */
export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, '').trim();
}

/**
 * Analyze temporal patterns - earnings by hour of day
 */
export function groupZapsByHour(zaps: ParsedZap[]): import('@/types/zaplytics').EarningsByHour[] {
  const grouped = new Map<number, { totalSats: number; zapCount: number }>();

  // Initialize all 24 hours with zero values
  for (let hour = 0; hour < 24; hour++) {
    grouped.set(hour, { totalSats: 0, zapCount: 0 });
  }

  zaps.forEach(zap => {
    const date = new Date(zap.receipt.created_at * 1000);
    const hour = date.getHours();
    const existing = grouped.get(hour)!;
    existing.totalSats += zap.amount;
    existing.zapCount += 1;
  });

  return Array.from(grouped.entries())
    .map(([hour, stats]) => ({
      hour,
      totalSats: stats.totalSats,
      zapCount: stats.zapCount,
      avgZapAmount: stats.zapCount > 0 ? Math.round(stats.totalSats / stats.zapCount) : 0,
    }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * Analyze temporal patterns - earnings by day of week
 */
export function groupZapsByDayOfWeek(zaps: ParsedZap[]): import('@/types/zaplytics').EarningsByDayOfWeek[] {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const grouped = new Map<number, { totalSats: number; zapCount: number }>();

  // Initialize all 7 days with zero values
  for (let day = 0; day < 7; day++) {
    grouped.set(day, { totalSats: 0, zapCount: 0 });
  }

  zaps.forEach(zap => {
    const date = new Date(zap.receipt.created_at * 1000);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const existing = grouped.get(dayOfWeek)!;
    existing.totalSats += zap.amount;
    existing.zapCount += 1;
  });

  return Array.from(grouped.entries())
    .map(([dayOfWeek, stats]) => ({
      dayOfWeek,
      dayName: dayNames[dayOfWeek],
      totalSats: stats.totalSats,
      zapCount: stats.zapCount,
      avgZapAmount: stats.zapCount > 0 ? Math.round(stats.totalSats / stats.zapCount) : 0,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

/**
 * Analyze zapper loyalty and retention patterns
 */
export function analyzeZapperLoyalty(zaps: ParsedZap[]): import('@/types/zaplytics').LoyaltyStats {
  const zapperData = new Map<string, {
    pubkey: string;
    name?: string;
    picture?: string;
    zaps: ParsedZap[];
    totalSats: number;
    zapCount: number;
  }>();

  // Group zaps by zapper — skip unknown senders: loyalty is unknowable for
  // receipts without a zap request, and folding them into one entity would
  // fabricate a whale/regular "supporter" that doesn't exist.
  zaps.forEach(zap => {
    if (zap.zapper.anonymous) return;
    const existing = zapperData.get(zap.zapper.pubkey);
    if (existing) {
      existing.zaps.push(zap);
      existing.totalSats += zap.amount;
      existing.zapCount += 1;
    } else {
      zapperData.set(zap.zapper.pubkey, {
        pubkey: zap.zapper.pubkey,
        name: zap.zapper.name,
        picture: zap.zapper.picture,
        zaps: [zap],
        totalSats: zap.amount,
        zapCount: 1,
      });
    }
  });

  const loyaltyAnalysis: import('@/types/zaplytics').ZapperLoyalty[] = [];
  let newZappers = 0;
  let returningZappers = 0;
  let regularSupporters = 0;

  zapperData.forEach(zapperInfo => {
    const sortedZaps = zapperInfo.zaps.sort((a, b) => a.receipt.created_at - b.receipt.created_at);
    const firstZapDate = new Date(sortedZaps[0].receipt.created_at * 1000);
    const lastZapDate = new Date(sortedZaps[sortedZaps.length - 1].receipt.created_at * 1000);
    
    const daysBetweenFirstAndLast = zapperInfo.zapCount > 1 
      ? Math.ceil((lastZapDate.getTime() - firstZapDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    const averageDaysBetweenZaps = zapperInfo.zapCount > 1 
      ? daysBetweenFirstAndLast / (zapperInfo.zapCount - 1)
      : 0;

    // Categorize zappers based on behavior patterns
    let category: 'whale' | 'regular' | 'occasional' | 'one-time';
    let isRegular = false;

    if (zapperInfo.zapCount === 1) {
      category = 'one-time';
      newZappers++;
    } else {
      returningZappers++;
      
      if (zapperInfo.totalSats >= 10000) { // 10k+ sats = whale
        category = 'whale';
      } else if (zapperInfo.zapCount >= 5 || (zapperInfo.zapCount >= 3 && averageDaysBetweenZaps <= 7)) {
        category = 'regular';
        isRegular = true;
        regularSupporters++;
      } else {
        category = 'occasional';
      }
    }

    loyaltyAnalysis.push({
      pubkey: zapperInfo.pubkey,
      name: zapperInfo.name,
      picture: zapperInfo.picture,
      zapCount: zapperInfo.zapCount,
      totalSats: zapperInfo.totalSats,
      firstZapDate,
      lastZapDate,
      daysBetweenFirstAndLast,
      averageDaysBetweenZaps,
      isRegular,
      category,
    });
  });

  const totalZappers = zapperData.size;
  const totalSatsValue = Array.from(zapperData.values()).reduce((sum, zapper) => sum + zapper.totalSats, 0);
  const averageLifetimeValue = totalZappers > 0 ? Math.round(totalSatsValue / totalZappers) : 0;

  // Sort by total sats for top loyal zappers
  const topLoyalZappers = loyaltyAnalysis
    .filter(zapper => zapper.zapCount > 1) // Only returning zealers
    .sort((a, b) => b.totalSats - a.totalSats)
    .slice(0, 10);

  return {
    newZappers,
    returningZappers,
    regularSupporters,
    averageLifetimeValue,
    topLoyalZappers,
  };
}

/**
 * Analyze content performance metrics
 */
export function analyzeContentPerformance(zaps: ParsedZap[]): import('@/types/zaplytics').ContentPerformance[] {
  const contentData = new Map<string, {
    eventId: string;
    eventKind: number;
    content: string;
    author: string;
    created_at: number;
    zaps: ParsedZap[];
    totalSats: number;
    zapCount: number;
  }>();

  // Group zaps by content
  zaps.forEach(zap => {
    if (!zap.zappedEvent) return;
    if (!zap.zappedEvent.content && zap.zappedEvent.created_at === 0) return;
    
    const existing = contentData.get(zap.zappedEvent.id);
    if (existing) {
      existing.zaps.push(zap);
      existing.totalSats += zap.amount;
      existing.zapCount += 1;
    } else {
      contentData.set(zap.zappedEvent.id, {
        eventId: zap.zappedEvent.id,
        eventKind: zap.zappedEvent.kind,
        content: zap.zappedEvent.content || '',
        author: zap.zappedEvent.author,
        created_at: zap.zappedEvent.created_at,
        zaps: [zap],
        totalSats: zap.amount,
        zapCount: 1,
      });
    }
  });

  const performanceAnalysis: import('@/types/zaplytics').ContentPerformance[] = [];

  contentData.forEach(content => {
    const sortedZaps = content.zaps.sort((a, b) => a.receipt.created_at - b.receipt.created_at);
    const contentCreatedAt = content.created_at * 1000;
    const firstZapTime = sortedZaps[0].receipt.created_at * 1000;
    const lastZapTime = sortedZaps[sortedZaps.length - 1].receipt.created_at * 1000;

    // Time to first zap (seconds from content creation to first zap)
    const timeToFirstZap = Math.max(0, (firstZapTime - contentCreatedAt) / 1000);

    // Content longevity (days between first and last zap)
    const longevityDays = content.zapCount > 1 
      ? (lastZapTime - firstZapTime) / (1000 * 60 * 60 * 24)
      : 0;

    // Virality score - percentage of zaps received in first hour
    const firstHourCutoff = contentCreatedAt + (60 * 60 * 1000); // 1 hour after creation
    const firstHourZaps = sortedZaps.filter(zap => (zap.receipt.created_at * 1000) <= firstHourCutoff);
    const viralityScore = content.zapCount > 0 ? (firstHourZaps.length / content.zapCount) * 100 : 0;

    // Peak earnings window - find the best performing time window
    const windows = [1, 6, 24, 72]; // hours
    let bestWindow = 1;
    let maxWindowEarnings = 0;

    windows.forEach(windowHours => {
      const windowMs = windowHours * 60 * 60 * 1000;
      const windowCutoff = contentCreatedAt + windowMs;
      const windowZaps = sortedZaps.filter(zap => (zap.receipt.created_at * 1000) <= windowCutoff);
      const windowEarnings = windowZaps.reduce((sum, zap) => sum + zap.amount, 0);
      
      if (windowEarnings > maxWindowEarnings) {
        maxWindowEarnings = windowEarnings;
        bestWindow = windowHours;
      }
    });

    const avgZapAmount = Math.round(content.totalSats / content.zapCount);

    performanceAnalysis.push({
      eventId: content.eventId,
      eventKind: content.eventKind,
      content: content.content,
      author: content.author,
      created_at: content.created_at,
      totalSats: content.totalSats,
      zapCount: content.zapCount,
      timeToFirstZap,
      peakEarningsWindow: bestWindow,
      longevityDays,
      viralityScore,
      avgZapAmount,
    });
  });

  return performanceAnalysis.sort((a, b) => b.totalSats - a.totalSats);
}

/**
 * Extract hashtags from content text
 */
function extractHashtags(text: string): string[] {
  const hashtagRegex = /#[a-zA-Z0-9_]+/g;
  const matches = text.match(hashtagRegex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

/**
 * Analyze hashtag performance
 */
export function analyzeHashtagPerformance(zaps: ParsedZap[]): import('@/types/zaplytics').HashtagPerformance[] {
  const hashtagData = new Map<string, {
    hashtag: string;
    totalSats: number;
    zapCount: number;
    posts: Set<string>;
    firstZapTimes: number[];
    contentCreatedTimes: number[];
  }>();

  const allPosts = new Map<string, { hashtags: string[], created_at: number, hasZaps: boolean }>();

  // First pass: collect all posts and their hashtags
  zaps.forEach(zap => {
    if (!zap.zappedEvent) return;
    
    const zappedEvent = zap.zappedEvent; // Store in variable for TypeScript
    const hashtags = extractHashtags(zappedEvent.content || '');
    
    if (!allPosts.has(zappedEvent.id)) {
      allPosts.set(zappedEvent.id, {
        hashtags,
        created_at: zappedEvent.created_at,
        hasZaps: true
      });
    }

    hashtags.forEach(hashtag => {
      const existing = hashtagData.get(hashtag);
      if (existing) {
        existing.totalSats += zap.amount;
        existing.zapCount += 1;
        existing.posts.add(zappedEvent.id);
        existing.firstZapTimes.push(zap.receipt.created_at);
        existing.contentCreatedTimes.push(zappedEvent.created_at);
      } else {
        hashtagData.set(hashtag, {
          hashtag,
          totalSats: zap.amount,
          zapCount: 1,
          posts: new Set([zappedEvent.id]),
          firstZapTimes: [zap.receipt.created_at],
          contentCreatedTimes: [zappedEvent.created_at],
        });
      }
    });
  });

  // Calculate success rates and other metrics
  const hashtagPerformance: import('@/types/zaplytics').HashtagPerformance[] = [];

  hashtagData.forEach((data) => {
    // Calculate average time to first zap
    const timeToFirstZaps = data.firstZapTimes.map((zapTime, index) => 
      Math.max(0, zapTime - data.contentCreatedTimes[index])
    );
    const avgTimeToFirstZap = timeToFirstZaps.length > 0 
      ? timeToFirstZaps.reduce((sum, time) => sum + time, 0) / timeToFirstZaps.length 
      : 0;

    const postCount = data.posts.size;
    
    // Success rate is 100% since we only have data for posts that got zapped
    // In a full implementation, we'd need to track all posts, not just zapped ones
    const successRate = 100; // This would be calculated differently with full post data
    
    const avgZapAmount = data.zapCount > 0 ? Math.round(data.totalSats / data.zapCount) : 0;

    hashtagPerformance.push({
      hashtag: data.hashtag,
      totalSats: data.totalSats,
      zapCount: data.zapCount,
      avgZapAmount,
      postCount,
      successRate,
      avgTimeToFirstZap,
    });
  });

  return hashtagPerformance
    .filter(h => h.zapCount >= 2) // Only include hashtags with at least 2 zaps
    .sort((a, b) => b.totalSats - a.totalSats);
}
