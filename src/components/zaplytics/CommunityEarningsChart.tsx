import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { EarningsByPeriod } from '@/types/zaplytics';
import { formatSats } from '@/lib/zaplytics/utils';

interface CommunityEarningsChartProps {
  members: Array<{
    pubkey: string;
    name: string;
    earningsByPeriod?: EarningsByPeriod[];
  }>;
  isLoading: boolean;
  timeRange?: '24h' | '7d' | '30d' | 'all';
}

// Distinct colors for member lines
const MEMBER_COLORS = [
  'hsl(222, 47%, 11%)',   // dark blue (primary)
  'hsl(142, 71%, 45%)',   // green
  'hsl(25, 95%, 53%)',    // orange
  'hsl(280, 65%, 60%)',   // purple
  'hsl(0, 84%, 60%)',     // red
  'hsl(199, 89%, 48%)',   // cyan
  'hsl(43, 96%, 56%)',    // amber
  'hsl(173, 80%, 40%)',   // teal
];

interface TooltipEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}

export function CommunityEarningsChart({ members, isLoading, timeRange = 'all' }: CommunityEarningsChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Member Earnings Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  // Filter members that have earningsByPeriod data
  const membersWithData = members.filter(m => m.earningsByPeriod && m.earningsByPeriod.length > 0);

  if (membersWithData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Member Earnings Comparison</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <p className="text-muted-foreground">No earnings data available</p>
        </CardContent>
      </Card>
    );
  }

  // Build a merged dataset.
  // Group by day for 7d/30d (enough data points to see trends),
  // by month for "all" (too many days otherwise).
  // 24h typically has 1 day — group by day so it shows at least 1 point.
  const groupByMonth = timeRange === 'all';
  const periodMap = new Map<string, Record<string, number>>();

  for (const member of membersWithData) {
    for (const period of member.earningsByPeriod!) {
      const key = groupByMonth ? period.period.substring(0, 7) : period.period;
      if (!periodMap.has(key)) {
        periodMap.set(key, {});
      }
      const entry = periodMap.get(key)!;
      entry[member.name] = (entry[member.name] || 0) + period.totalSats;
    }
  }

  // Sort by period and build chart data
  const sortedPeriods = Array.from(periodMap.keys()).sort();
  const chartData = sortedPeriods.map(period => {
    const entry: Record<string, string | number> = {
      period: groupByMonth ? formatMonthLabel(period) : formatDayLabel(period),
    };
    const memberData = periodMap.get(period)!;
    for (const member of membersWithData) {
      entry[member.name] = memberData[member.name] || 0;
    }
    return entry;
  });

  const CustomTooltip = ({ active, payload, label }: ChartTooltipProps) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-card border rounded-lg shadow-lg p-3 max-w-xs">
        <p className="text-sm font-medium mb-2">{label}</p>
        <div className="space-y-1">
          {payload
            .filter(e => e.value > 0)
            .sort((a, b) => b.value - a.value)
            .map((entry, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span>{entry.name}</span>
                </div>
                <span className="font-medium tabular-nums">{formatSats(entry.value)} sats</span>
              </div>
            ))}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Member Earnings Comparison</CardTitle>
        <p className="text-sm text-muted-foreground">
          {groupByMonth ? 'Monthly' : 'Daily'} earnings per member over time
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="period"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => formatSats(value)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                iconType="circle"
              />
              {membersWithData.map((member, i) => (
                <Line
                  key={member.pubkey}
                  type="monotone"
                  dataKey={member.name}
                  stroke={MEMBER_COLORS[i % MEMBER_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function formatMonthLabel(monthKey: string): string {
  try {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  } catch {
    return monthKey;
  }
}

function formatDayLabel(dayKey: string): string {
  try {
    const date = new Date(dayKey + 'T00:00:00Z');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return dayKey;
  }
}
