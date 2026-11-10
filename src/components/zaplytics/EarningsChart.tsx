import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip,
  BarChart,
  Bar
} from 'recharts';
import type { EarningsByPeriod, TimeRange, CustomDateRange } from '@/types/zaplytics';
import { formatSats } from '@/lib/zaplytics/utils';

interface EarningsChartProps {
  data: EarningsByPeriod[];
  timeRange: TimeRange;
  customRange?: CustomDateRange;
  isLoading: boolean;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      totalSats: number;
      zapCount: number;
      date: string;
    };
  }>;
  label?: string;
}

export function EarningsChart({ data, timeRange, customRange, isLoading }: EarningsChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Earnings Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Earnings Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <p className="text-muted-foreground">No earnings data for this time period</p>
        </CardContent>
      </Card>
    );
  }

  // Format the data for the chart
  const chartData = data.map(item => ({
    period: formatPeriodLabel(item.period, timeRange, customRange),
    totalSats: item.totalSats,
    zapCount: item.zapCount,
    date: item.date.toISOString(),
  }));

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    return (
      <div className="bg-card border rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium">{label}</p>
        <div className="mt-1 space-y-1">
          <p className="text-sm text-primary">
            <span className="font-medium">{formatSats(data.totalSats)}</span> sats
          </p>
          <p className="text-sm text-muted-foreground">
            {data.zapCount} zap{data.zapCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Earnings Over Time</CardTitle>
        <p className="text-sm text-muted-foreground">
          Showing earnings by {getGroupByLabel(timeRange, customRange)}
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {timeRange === '24h' ? (
              <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="period" 
                  className="text-xs fill-muted-foreground"
                  tick={{ fontSize: 12 }}
                />
                <YAxis 
                  className="text-xs fill-muted-foreground"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => formatSats(value)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar 
                  dataKey="totalSats" 
                  fill="var(--primary)"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                <Area 
                  type="monotone" 
                  dataKey="totalSats" 
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function formatPeriodLabel(period: string, timeRange: TimeRange, customRange?: CustomDateRange): string {
  try {
    const date = new Date(period);
    
    // For custom ranges, determine formatting based on the range length
    if (timeRange === 'custom' && customRange) {
      const daysDiff = Math.ceil((customRange.to.getTime() - customRange.from.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff <= 2) {
        // Hour format for very short ranges
        return date.getHours().toString().padStart(2, '0') + ':00';
      } else if (daysDiff <= 7) {
        // Day format for ranges up to a month
        return (date.getUTCMonth() + 1) + '/' + date.getUTCDate();
      } else if (daysDiff <= 90) {
        // Week-start format — groupZapsByPeriod buckets 31–90 day ranges
        // weekly, so the label must show the day or every week in a month
        // renders identically ("Mar 26").
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          timeZone: 'UTC'
        });
      } else {
        // Month format for longer ranges
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          year: '2-digit',
          timeZone: 'UTC'
        });
      }
    }
    
    switch (timeRange) {
      case '24h':
        return date.getHours().toString().padStart(2, '0') + ':00';
      case '7d':
        return (date.getUTCMonth() + 1) + '/' + date.getUTCDate();
      case 'all':
        return date.toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC'
        });
      default:
        return period;
    }
  } catch {
    return period;
  }
}

function getGroupByLabel(timeRange: TimeRange, customRange?: CustomDateRange): string {
  if (timeRange === 'custom' && customRange) {
    const daysDiff = Math.ceil((customRange.to.getTime() - customRange.from.getTime()) / (1000 * 60 * 60 * 24));
    
    // Thresholds must match groupZapsByPeriod's bucketing exactly —
    // 8–31 day ranges are daily buckets (not weekly) and 32–90 day
    // ranges are weekly (not monthly).
    if (daysDiff <= 2) {
      return 'hour';
    } else if (daysDiff <= 31) {
      return 'day';
    } else if (daysDiff <= 90) {
      return 'week';
    } else {
      return 'month';
    }
  }
  
  switch (timeRange) {
    case '24h':
      return 'hour';
    case '7d':
      return 'day';
    case 'all':
      return 'month';
    default:
      return 'period';
  }
}