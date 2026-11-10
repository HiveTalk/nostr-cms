import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Hash, Zap, Target, Clock } from 'lucide-react';
import type { HashtagPerformance } from '@/types/zaplytics';
import { formatSats } from '@/lib/zaplytics/utils';

interface HashtagAnalyticsProps {
  data: HashtagPerformance[];
  isLoading: boolean;
}

const formatTimeToFirstZap = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
};

export function HashtagAnalytics({ data, isLoading }: HashtagAnalyticsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hashtag Performance</CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-blue-500" />
            Hashtag Performance
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Track which hashtags drive the most engagement
          </p>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px]">
          <div className="text-center">
            <Hash className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">No hashtag data available</p>
            <p className="text-sm text-muted-foreground mt-1">
              Use hashtags in your content to see performance analytics
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const topHashtag = data[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-blue-500" />
          Hashtag Performance
          <Badge variant="secondary">{data.length}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your best performing hashtags - optimize your content strategy
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top Performer Highlight */}
        {topHashtag && (
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <h4 className="text-sm font-medium">Top Performing Hashtag</h4>
              </div>
              <Badge className="bg-primary text-primary-foreground font-mono">
                {topHashtag.hashtag}
              </Badge>
            </div>
            
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-primary">{formatSats(topHashtag.totalSats)}</div>
                <div className="text-xs text-muted-foreground">Total Sats</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">{topHashtag.zapCount}</div>
                <div className="text-xs text-muted-foreground">Zaps</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">{topHashtag.postCount}</div>
                <div className="text-xs text-muted-foreground">Posts</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">{formatSats(topHashtag.avgZapAmount)}</div>
                <div className="text-xs text-muted-foreground">Avg/Zap</div>
              </div>
            </div>
          </div>
        )}

        {/* All Hashtags List */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">All Hashtag Performance</h4>
          <div className="space-y-3">
            {data.slice(0, 15).map((hashtag, index) => (
              <div key={hashtag.hashtag} className="flex items-center gap-4 p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                {/* Rank */}
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-muted border">
                  <span className="text-sm font-medium">#{index + 1}</span>
                </div>

                {/* Hashtag Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium font-mono">
                      {hashtag.hashtag}
                    </h4>
                    <Badge variant="outline" className="text-xs">
                      {hashtag.postCount} post{hashtag.postCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {hashtag.zapCount} zap{hashtag.zapCount !== 1 ? 's' : ''}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimeToFirstZap(hashtag.avgTimeToFirstZap)} response
                    </div>
                    {/* successRate intentionally not displayed — only
                        zapped posts are tracked, so it's always 100% and
                        meaningless. Real rate needs all-posts data. */}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex-shrink-0 text-right">
                  <div className="text-lg font-bold text-primary">
                    {formatSats(hashtag.totalSats)}
                  </div>
                  <div className="text-xs text-muted-foreground">sats</div>
                  
                  <div className="text-xs mt-1">
                    {formatSats(hashtag.avgZapAmount)} avg
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Hash className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hashtag performance data yet</p>
              <p className="text-sm">Start using hashtags in your posts!</p>
            </div>
          )}

          {data.length > 15 && (
            <div className="text-center pt-4">
              <p className="text-sm text-muted-foreground">
                Showing top 15 of {data.length} hashtags
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}