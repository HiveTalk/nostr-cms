import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Users, Heart, TrendingUp, Clock, ExternalLink } from 'lucide-react';
import type { LoyaltyStats, ZapperLoyalty } from '@/types/zaplytics';
import { formatSats, createNjumpProfileLink } from '@/lib/zaplytics/utils';
import { genUserName } from '@/lib/genUserName';
import { useAuthor } from '@/hooks/useAuthor';

interface ZapperLoyaltyProps {
  data: LoyaltyStats;
  isLoading: boolean;
}

const getCategoryInfo = (category: ZapperLoyalty['category']) => {
  switch (category) {
    case 'whale':
      return { 
        label: 'Whale', 
        color: 'bg-purple-500', 
        description: '10k+ sats',
        icon: '🐋'
      };
    case 'regular':
      return { 
        label: 'Regular', 
        color: 'bg-green-500', 
        description: '5+ zaps or frequent',
        icon: '⭐'
      };
    case 'occasional':
      return { 
        label: 'Occasional', 
        color: 'bg-blue-500', 
        description: '2-4 zaps',
        icon: '👋'
      };
    case 'one-time':
      return { 
        label: 'One-time', 
        color: 'bg-gray-500', 
        description: 'Single zap',
        icon: '💫'
      };
  }
};

const formatDuration = (days: number): string => {
  if (days < 1) return '< 1 day';
  if (days < 30) return `${Math.round(days)} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
};

export function ZapperLoyalty({ data, isLoading }: ZapperLoyaltyProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Supporter Loyalty</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const totalZappers = data.newZappers + data.repeatZappers;

  if (totalZappers === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Supporter Loyalty</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <p className="text-muted-foreground">No supporter loyalty data available</p>
        </CardContent>
      </Card>
    );
  }

  const loyaltyRate = totalZappers > 0 ? (data.repeatZappers / totalZappers) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-red-500" />
          Supporter Loyalty
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Understanding your supporter base and retention patterns
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{totalZappers}</div>
            <div className="text-xs text-muted-foreground">Total Supporters</div>
          </div>
          
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold">{loyaltyRate.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">Loyalty Rate</div>
          </div>
          
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <Heart className="h-4 w-4 text-red-500" />
            </div>
            <div className="text-2xl font-bold">{data.regularSupporters}</div>
            <div className="text-xs text-muted-foreground">Regular Supporters</div>
          </div>
          
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold">{formatSats(data.averageLifetimeValue)}</div>
            <div className="text-xs text-muted-foreground">Avg LTV</div>
          </div>
        </div>

        {/* Loyalty Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Supporter Breakdown</h4>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">New supporters</span>
              <span className="text-sm font-medium">{data.newZappers}</span>
            </div>
            <Progress 
              value={totalZappers > 0 ? (data.newZappers / totalZappers) * 100 : 0} 
              className="h-2"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Returning supporters</span>
              <span className="text-sm font-medium">{data.repeatZappers}</span>
            </div>
            <Progress 
              value={totalZappers > 0 ? (data.repeatZappers / totalZappers) * 100 : 0} 
              className="h-2"
            />
          </div>
        </div>

        {/* Top Loyal Supporters */}
        {data.topLoyalZappers.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Most Loyal Supporters</h4>
            <div className="space-y-3">
              {data.topLoyalZappers.slice(0, 10).map((zapper) => (
                <ZapperRow key={zapper.pubkey} zapper={zapper} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Individual zapper row — fetches profile via useAuthor if
 * name/picture are not already provided in the data.
 */
function ZapperRow({ zapper }: { zapper: ZapperLoyalty }) {
  const categoryInfo = getCategoryInfo(zapper.category);

  // Only fetch if we don't already have name/picture from the data
  const { data: authorData } = useAuthor(
    zapper.name || zapper.picture ? undefined : zapper.pubkey
  );

  const name = zapper.name || authorData?.metadata?.name || authorData?.metadata?.display_name || genUserName(zapper.pubkey);
  const picture = zapper.picture || authorData?.metadata?.picture;

  return (
    <div className="flex items-center gap-4 p-4 border rounded-lg hover:bg-accent/50 transition-colors">
      <Avatar className="h-10 w-10">
        <AvatarImage src={picture} alt={name} />
        <AvatarFallback>
          {name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-sm font-medium truncate">{name}</h4>
          <Badge
            variant="secondary"
            className="text-xs px-2 py-0 h-5"
            style={{ backgroundColor: categoryInfo.color + '20', color: categoryInfo.color }}
          >
            {categoryInfo.icon} {categoryInfo.label}
          </Badge>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{zapper.zapCount} zaps</span>
          <span>{formatSats(zapper.totalSats)} sats</span>
          {zapper.averageDaysBetweenZaps > 0 && (
            <span>~{formatDuration(zapper.averageDaysBetweenZaps)} between zaps</span>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 text-right">
        <div className="text-lg font-bold text-primary">
          {formatSats(zapper.totalSats)}
        </div>
        <div className="text-xs text-muted-foreground">sats</div>

        <a
          href={createNjumpProfileLink(zapper.pubkey)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 mt-1 transition-opacity"
        >
          View Profile <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}