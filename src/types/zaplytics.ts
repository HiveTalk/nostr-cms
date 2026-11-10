export interface ZapReceipt {
  id: string;
  created_at: number;
  pubkey: string;
  kind: 9735;
  tags: [string, string, ...string[]][];
  content: string;
  sig: string;
}

export interface ParsedZap {
  receipt: ZapReceipt;
  zappedEvent?: {
    id: string;
    kind: number;
    author: string;
    content: string;
    created_at: number;
  };
  zapper: {
    pubkey: string;
    name?: string;
    nip05?: string;
    picture?: string;
    /** True when the receipt carries no zap request — pubkey is then the
     *  LNURL server's key, not the actual sender's. */
    anonymous?: boolean;
  };
  amount: number; // sats
  comment?: string;
  zapRequest?: {
    pubkey: string;
    content: string;
    created_at: number;
  };
}

export interface EarningsByPeriod {
  period: string;
  totalSats: number;
  zapCount: number;
  date: Date;
}

export interface EarningsByContent {
  eventId: string;
  eventKind: number;
  content: string;
  author: string;
  totalSats: number;
  zapCount: number;
  created_at: number;
}

export interface EarningsByKind {
  kind: number;
  kindName: string;
  totalSats: number;
  zapCount: number;
  percentage: number;
}

export interface ZapperStats {
  pubkey: string;
  name?: string;
  nip05?: string;
  picture?: string;
  /** True for the aggregate unknown-sender bucket — never a real identity;
   *  must not join cross-member graphs or carry profile metadata. */
  anonymous?: boolean;
  totalSats: number;
  zapCount: number;
}

// New types for temporal analytics
export interface EarningsByHour {
  hour: number;
  totalSats: number;
  zapCount: number;
  avgZapAmount: number;
}

export interface EarningsByDayOfWeek {
  dayOfWeek: number;
  dayName: string;
  totalSats: number;
  zapCount: number;
  avgZapAmount: number;
}

// New types for zapper loyalty analytics
export interface ZapperLoyalty {
  pubkey: string;
  name?: string;
  picture?: string;
  zapCount: number;
  totalSats: number;
  firstZapDate: Date;
  lastZapDate: Date;
  daysBetweenFirstAndLast: number;
  averageDaysBetweenZaps: number;
  isRegular: boolean; // 3+ zaps with reasonable frequency
  category: 'whale' | 'regular' | 'occasional' | 'one-time';
}

export interface LoyaltyStats {
  newZappers: number;
  returningZappers: number;
  regularSupporters: number;
  averageLifetimeValue: number;
  topLoyalZappers: ZapperLoyalty[];
}

// New types for content performance analytics
export interface ContentPerformance {
  eventId: string;
  eventKind: number;
  content: string;
  author: string;
  created_at: number;
  totalSats: number;
  zapCount: number;
  timeToFirstZap: number; // seconds from creation to first zap
  peakEarningsWindow: number; // hours of peak earnings (first 1h, 6h, 24h, etc.)
  longevityDays: number; // days between first and last zap
  viralityScore: number; // zaps in first hour / total zaps
  avgZapAmount: number;
}

// New types for hashtag performance analytics
export interface HashtagPerformance {
  hashtag: string;
  totalSats: number;
  zapCount: number;
  avgZapAmount: number;
  postCount: number;
  successRate: number; // % of posts with this hashtag that get zapped
  avgTimeToFirstZap: number;
}

export interface AnalyticsData {
  totalEarnings: number;
  totalZaps: number;
  uniqueZappers: number;
  period: string;
  earningsByPeriod: EarningsByPeriod[];
  topContent: EarningsByContent[];
  earningsByKind: EarningsByKind[];
  topZappers: ZapperStats[];
  allZaps: ParsedZap[];
  
  // New analytics data
  temporalPatterns: {
    earningsByHour: EarningsByHour[];
    earningsByDayOfWeek: EarningsByDayOfWeek[];
  };
  zapperLoyalty: LoyaltyStats;
  contentPerformance: ContentPerformance[];
  
  // Content creator analytics
  hashtagPerformance: HashtagPerformance[];
}

export type TimeRange = '24h' | '7d' | 'all' | 'custom';

export interface TimeRangeConfig {
  label: string;
  days: number | null; // null for 'custom' and 'all'
  groupBy: 'hour' | 'day' | 'week' | 'month';
}

export const TIME_RANGES: Record<TimeRange, TimeRangeConfig> = {
  '24h': { label: 'Last 24 hours', days: 1, groupBy: 'hour' },
  '7d': { label: 'Last 7 days', days: 7, groupBy: 'day' },
  'all': { label: 'All time', days: null, groupBy: 'month' },
  'custom': { label: 'Custom range', days: null, groupBy: 'day' },
};

export interface CustomDateRange {
  from: Date;
  to: Date;
}

export interface DateRangeState {
  timeRange: TimeRange;
  customRange?: CustomDateRange;
}

export const KIND_NAMES: Record<number, string> = {
  0: 'Profiles',
  1: 'Notes',
  3: 'Contact Lists',
  4: 'Encrypted DMs',
  5: 'Event Deletions',
  6: 'Reactions',
  7: 'Reactions',
  40: 'Channel Creation',
  41: 'Channel Metadata',
  42: 'Channel Message',
  43: 'Channel Hide Message',
  44: 'Channel Mute User',
  1984: 'Problem Reports',
  9734: 'Zap Requests',
  9735: 'Zap Receipts',
  10002: 'Relay List Metadata',
  22242: 'Client Auth',
  30000: 'People Lists',
  30001: 'Bookmarks Lists',
  30008: 'Profile Badges',
  30009: 'Badge Definitions',
  30017: 'Create/Update Stall',
  30018: 'Create/Update Product',
  30023: 'Long-form Articles',
  30024: 'Draft Long-form Articles',
  30311: 'Live Events',
  30315: 'User Statuses',
  30402: 'Classified Listings',
  30403: 'Draft Classified Listings',
  31922: 'Date-Based Calendar Event',
  31923: 'Time-Based Calendar Event',
  31924: 'Calendar',
  31925: 'Calendar Event RSVP',
  31989: 'Handler Recommendation',
  31990: 'Handler Information',
  34550: 'Community Definition',
};
