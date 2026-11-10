import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useRef, useEffect } from 'react';
import type { EarningsByPeriod } from '@/types/zaplytics';
import type { MemberStats } from '@/hooks/useCommunityZapStats';
import { formatSats } from '@/lib/zaplytics/utils';

interface CommunityHeatmapProps {
  data: EarningsByPeriod[];
  members: MemberStats[];
  isLoading: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

const CELL_SIZE = 12;
const CELL_GAP = 3;
const COL_WIDTH = CELL_SIZE + CELL_GAP; // 15px per week column

interface DayCell {
  date: Date;
  totalSats: number;
  zapCount: number;
  members: { name: string; sats: number }[];
}

// Log-based color scale: uses logarithm of sats so small differences
// (21 vs 150 sats) are visible while large values don't saturate.
function getColor(sats: number, maxSats: number): string {
  if (sats === 0 || maxSats === 0) return 'hsl(215.4 16.3% 92%)';
  // Use log scale: log(1+sats) / log(1+maxSats)
  const ratio = Math.log(1 + sats) / Math.log(1 + maxSats);
  // Map ratio (0-1) to lightness (88% → 28%)
  const lightness = 88 - ratio * 60;
  return `hsl(142, 71%, ${lightness}%)`;
}

export function CommunityHeatmap({ data, members, isLoading }: CommunityHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<DayCell | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the right (most recent) on mount / when data changes.
  // This must be above all conditional returns so React's hook order stays
  // consistent across every render (loading, empty, and loaded states).
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Heatmap</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          <p className="text-muted-foreground">No activity data available</p>
        </CardContent>
      </Card>
    );
  }

  // Build a map of date string → DayCell (with per-member breakdown)
  const dayMap = new Map<string, DayCell>();
  let maxSats = 0;

  // First pass: aggregate totals from community data
  for (const period of data) {
    const dateKey = period.period.substring(0, 10);
    const date = new Date(period.date);
    dayMap.set(dateKey, {
      date,
      totalSats: period.totalSats,
      zapCount: period.zapCount,
      members: [],
    });
    if (period.totalSats > maxSats) maxSats = period.totalSats;
  }

  // Second pass: add per-member breakdown from member data
  for (const member of members) {
    if (!member.earningsByPeriod) continue;
    for (const period of member.earningsByPeriod) {
      if (period.totalSats === 0) continue;
      const dateKey = period.period.substring(0, 10);
      const cell = dayMap.get(dateKey);
      if (cell) {
        cell.members.push({ name: member.name, sats: period.totalSats });
      }
    }
  }

  // Sort members by sats descending in each cell
  for (const cell of dayMap.values()) {
    cell.members.sort((a, b) => b.sats - a.sats);
  }

  // Find date range
  const allDates = Array.from(dayMap.values()).map(d => d.date);
  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));

  // Build weeks (columns) starting from the Sunday before minDate.
  // All calendar math runs in UTC: period.date is a UTC midnight and cell
  // lookup keys come from toISOString() — local-time setDate would shift a
  // cell's UTC day across a DST transition, duplicating one date and
  // dropping the last one.
  const startDate = new Date(minDate);
  startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

  const weeks: Date[][] = [];
  const current = new Date(startDate);
  while (current <= maxDate) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  // Month labels: which week index starts a new month
  const monthLabels: { weekIndex: number; label: string; year: number }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const month = week[0].getUTCMonth();
    if (month !== lastMonth) {
      monthLabels.push({ weekIndex: i, label: MONTH_NAMES[month], year: week[0].getUTCFullYear() });
      lastMonth = month;
    }
  });

  function getCellForDate(date: Date): DayCell | null {
    const dateKey = date.toISOString().substring(0, 10);
    return dayMap.get(dateKey) || null;
  }

  const gridWidth = weeks.length * COL_WIDTH;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Heatmap</CardTitle>
        <p className="text-sm text-muted-foreground">
          Daily earnings — scroll left for older data
        </p>
      </CardHeader>
      <CardContent>
        <div ref={scrollRef} className="overflow-x-auto pb-2" style={{ maxHeight: '220px' }}>
          <div style={{ minWidth: 'max-content', paddingLeft: '32px' }}>
            {/* Month labels — absolutely positioned to align with week columns */}
            <div className="relative" style={{ height: '16px', width: `${gridWidth}px` }}>
              {monthLabels.map((ml) => {
                const left = ml.weekIndex * COL_WIDTH;
                // Show year on the first month of each year
                const isFirstOfYear = monthLabels.filter(m => m.year === ml.year).indexOf(ml) === 0;
                return (
                  <div
                    key={`${ml.year}-${ml.label}`}
                    className="absolute text-[10px] text-muted-foreground whitespace-nowrap"
                    style={{ left: `${left}px`, top: 0 }}
                  >
                    {isFirstOfYear ? `${ml.label} ${ml.year}` : ml.label}
                  </div>
                );
              })}
            </div>

            {/* Grid: day labels + weeks */}
            <div className="flex gap-1 mt-1">
              {/* Day labels */}
              <div className="flex flex-col gap-[3px]" style={{ width: '28px', marginLeft: '-32px' }}>
                {DAY_LABELS.map((label, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground flex items-center" style={{ height: `${CELL_SIZE}px` }}>
                    {label}
                  </div>
                ))}
              </div>

              {/* Weeks */}
              <div className="flex gap-[3px]">
                {weeks.map((week, weekIdx) => (
                  <div key={weekIdx} className="flex flex-col gap-[3px]">
                    {week.map((date) => {
                      const cell = getCellForDate(date);
                      const isFuture = date > maxDate;
                      const isBeforeMin = date < minDate;
                      const color = cell ? getColor(cell.totalSats, maxSats) : 'transparent';
                      return (
                        <div
                          key={date.toISOString()}
                          className="rounded-sm"
                          style={{
                            width: `${CELL_SIZE}px`,
                            height: `${CELL_SIZE}px`,
                            backgroundColor: isFuture || isBeforeMin ? 'transparent' : color,
                            cursor: cell ? 'pointer' : 'default',
                          }}
                          onMouseEnter={() => cell && setHoveredCell(cell)}
                          onMouseLeave={() => setHoveredCell(null)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-2">
              <span>Less</span>
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => {
                const lightness = 88 - r * 60;
                return (
                  <div
                    key={r}
                    className="rounded-sm"
                    style={{
                      width: `${CELL_SIZE}px`,
                      height: `${CELL_SIZE}px`,
                      backgroundColor: r === 0 ? 'hsl(215.4 16.3% 92%)' : `hsl(142, 71%, ${lightness}%)`,
                    }}
                  />
                );
              })}
              <span>More</span>
            </div>
          </div>
        </div>

        {/* Hover tooltip — shows per-member breakdown */}
        {hoveredCell && (
          <div className="mt-2 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-foreground">
                {hoveredCell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
              </span>
              <span className="text-primary font-medium">{formatSats(hoveredCell.totalSats)} sats</span>
              <span className="text-muted-foreground">{hoveredCell.zapCount} zap{hoveredCell.zapCount !== 1 ? 's' : ''}</span>
            </div>
            {hoveredCell.members.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {hoveredCell.members.map((m, i) => (
                  <span key={i} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.name}</span>: {formatSats(m.sats)} sats
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
