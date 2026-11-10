import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { MemberStats } from '@/hooks/useCommunityZapStats';
import { formatSats } from '@/lib/zaplytics/utils';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostr } from '@nostrify/react';
import { queryWithNip65Fanout, getNip65ReadRelays } from '@/lib/queryRelays';
import { NSchema as n } from '@nostrify/nostrify';

interface ContributorNetworkGraphProps {
  members: MemberStats[];
  isLoading: boolean;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'member' | 'zapper';
  x: number;
  y: number;
  radius: number;
  color: string;
  totalSats: number;
  zapCount: number;
  memberCount?: number;
  picture?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  sats: number;
  zapCount: number;
}

const MEMBER_COLOR = 'hsl(222, 47%, 11%)';
const MULTI_ZAPPER_COLOR = 'hsl(142, 71%, 45%)';
const SINGLE_ZAPPER_COLOR = 'hsl(25, 95%, 53%)';

const WIDTH = 600;
const HEIGHT = 400;

export function ContributorNetworkGraph({ members, isLoading }: ContributorNetworkGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null);

  const { nodes, edges } = useMemo(() => buildGraph(members), [members]);

  // Fetch profile pictures for member nodes
  const memberPubkeys = nodes.filter(n => n.type === 'member').map(n => n.id);
  const profileMap = useMemberProfiles(memberPubkeys);

  // Enrich nodes with profile pictures
  const enrichedNodes = nodes.map(n => {
    if (n.type === 'member') {
      const profile = profileMap.get(n.id);
      return { ...n, picture: profile?.picture, label: profile?.name || n.label };
    }
    return n;
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contributor Network</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (enrichedNodes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contributor Network</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <p className="text-muted-foreground">No contributor data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contributor Network</CardTitle>
        <p className="text-sm text-muted-foreground">
          Zappers connected to members — green = supports multiple members, orange = single member
        </p>
      </CardHeader>
      <CardContent>
        <div className="relative w-full" style={{ aspectRatio: `${WIDTH}/${HEIGHT}` }}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-full"
            style={{ maxWidth: '100%' }}
          >
            {/* Edges */}
            {edges.map((edge, i) => {
              const source = enrichedNodes.find(n => n.id === edge.source);
              const target = enrichedNodes.find(n => n.id === edge.target);
              if (!source || !target) return null;
              const isHovered = hoveredEdge === edge;
              const maxSats = Math.max(...edges.map(e => e.sats));
              const strokeWidth = maxSats > 0 ? 1 + (edge.sats / maxSats) * 4 : 1;
              return (
                <line
                  key={i}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isHovered ? 'hsl(222, 47%, 11%)' : 'hsl(215.4 16.3% 80%)'}
                  strokeWidth={isHovered ? strokeWidth + 1 : strokeWidth}
                  strokeOpacity={isHovered ? 0.8 : 0.4}
                  onMouseEnter={() => setHoveredEdge(edge)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ cursor: 'pointer' }}
                />
              );
            })}

            {/* Nodes */}
            {enrichedNodes.map((node) => {
              const isHovered = hoveredNode === node;
              // Use a stable clip path ID based on node id
              const clipId = `clip-${node.id.replace(/[^a-zA-Z0-9]/g, '')}`;
              return (
                <g
                  key={node.id}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {node.picture ? (
                    // Avatar image clipped to circle (for both members and zappers with pictures)
                    <>
                      <defs>
                        <clipPath id={clipId}>
                          <circle cx={node.x} cy={node.y} r={node.radius} />
                        </clipPath>
                      </defs>
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius}
                        fill="hsl(215.4 16.3% 90%)"
                        stroke={isHovered ? 'hsl(222, 47%, 11%)' : node.color}
                        strokeWidth={isHovered ? 3 : 2}
                      />
                      <image
                        href={node.picture}
                        x={node.x - node.radius}
                        y={node.y - node.radius}
                        width={node.radius * 2}
                        height={node.radius * 2}
                        clipPath={`url(#${clipId})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </>
                  ) : (
                    // Plain circle for nodes without picture
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill={node.color}
                      fillOpacity={isHovered ? 0.9 : 0.7}
                      stroke={node.color}
                      strokeWidth={isHovered ? 2 : 1}
                    />
                  )}
                  {node.type === 'member' && (
                    <text
                      x={node.x}
                      y={node.y + node.radius + 14}
                      textAnchor="middle"
                      className="text-xs font-medium"
                      fill="hsl(222, 47%, 11%)"
                      style={{ fontSize: '11px' }}
                    >
                      {node.label.length > 12 ? node.label.substring(0, 10) + '...' : node.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Tooltip */}
          {(hoveredNode || hoveredEdge) && (
            <div className="absolute top-2 left-2 bg-card border rounded-lg shadow-lg p-3 text-sm max-w-xs pointer-events-none">
              {hoveredNode && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {hoveredNode.picture && (
                      <img
                        src={hoveredNode.picture}
                        alt=""
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    )}
                    {!hoveredNode.picture && (
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: hoveredNode.color }} />
                    )}
                    <span className="font-medium">{hoveredNode.label}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {hoveredNode.type === 'member' ? 'Community member' : 'Zapper'}
                  </p>
                  <p className="text-primary font-medium">{formatSats(hoveredNode.totalSats)} sats</p>
                  <p className="text-muted-foreground">{hoveredNode.zapCount} zaps</p>
                  {hoveredNode.memberCount !== undefined && (
                    <p className="text-muted-foreground">
                      Supports {hoveredNode.memberCount} member{hoveredNode.memberCount !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}
              {hoveredEdge && !hoveredNode && (
                <div className="space-y-1">
                  <p className="font-medium">{formatSats(hoveredEdge.sats)} sats</p>
                  <p className="text-muted-foreground">{hoveredEdge.zapCount} zaps</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MEMBER_COLOR }} />
            <span>Member</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MULTI_ZAPPER_COLOR }} />
            <span>Multi-member zapper</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SINGLE_ZAPPER_COLOR }} />
            <span>Single-member zapper</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Hook to fetch member profiles (name + picture) using useQueries.
// This properly follows the Rules of Hooks — the number of queries is
// fixed per render via useQueries, even if pubkeys.length changes.
function useMemberProfiles(pubkeys: string[]): Map<string, { name?: string; picture?: string }> {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const nip65ReadRelays = getNip65ReadRelays(config.relayMetadata);

  const queries = useQueries({
    queries: pubkeys.map((pubkey) => ({
      queryKey: ['author', pubkey],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (!pubkey) return null;
        let [event] = await queryWithNip65Fanout(
          nostr,
          [{ kinds: [0], authors: [pubkey], limit: 1 }],
          nip65ReadRelays,
          AbortSignal.any([signal, AbortSignal.timeout(1500)]),
        );
        if (!event) {
          try {
            const [purpleEvent] = await nostr.query(
              [{ kinds: [0], authors: [pubkey], limit: 1 }],
              { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), relays: ['wss://purplepag.es'] },
            );
            if (purpleEvent) event = purpleEvent;
          } catch { /* ignore */ }
        }
        if (!event) return null;
        try {
          return n.json().pipe(n.metadata()).parse(event.content);
        } catch {
          return null;
        }
      },
      staleTime: 5 * 60 * 1000,
      retry: 1,
    })),
  });

  const profiles = new Map<string, { name?: string; picture?: string }>();
  pubkeys.forEach((pubkey, i) => {
    const metadata = queries[i]?.data;
    if (metadata) {
      profiles.set(pubkey, {
        name: metadata.name || metadata.display_name,
        picture: metadata.picture,
      });
    }
  });

  return profiles;
}

function buildGraph(members: MemberStats[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const membersWithZaps = members.filter(m => m.totalZaps > 0 && m.topZappers && m.topZappers.length > 0);
  if (membersWithZaps.length === 0) return { nodes: [], edges: [] };

  // Collect all zappers and which members they zap
  const zapperMembers = new Map<string, Set<string>>();
  const zapperSats = new Map<string, number>();
  const zapperZaps = new Map<string, number>();
  const zapperNames = new Map<string, string>();
  const zapperPictures = new Map<string, string>();

  for (const member of membersWithZaps) {
    for (const zapper of member.topZappers!) {
      // The anonymous bucket isn't a real sender — joining members on it
      // would fabricate a shared multi-member supporter from unrelated
      // requestless zaps. Amounts still count in earnings elsewhere.
      if (zapper.anonymous) continue;
      if (!zapperMembers.has(zapper.pubkey)) {
        zapperMembers.set(zapper.pubkey, new Set());
        zapperSats.set(zapper.pubkey, 0);
        zapperZaps.set(zapper.pubkey, 0);
      }
      zapperMembers.get(zapper.pubkey)!.add(member.pubkey);
      zapperSats.set(zapper.pubkey, zapperSats.get(zapper.pubkey)! + zapper.totalSats);
      zapperZaps.set(zapper.pubkey, zapperZaps.get(zapper.pubkey)! + zapper.zapCount);
      // Use zapper name if available, otherwise "[Anonymous]"
      if (zapper.name) {
        zapperNames.set(zapper.pubkey, zapper.name);
      } else if (!zapperNames.has(zapper.pubkey)) {
        zapperNames.set(zapper.pubkey, '[Anonymous]');
      }
      // Collect picture if available
      if (zapper.picture) {
        zapperPictures.set(zapper.pubkey, zapper.picture);
      }
    }
  }

  // Multi-member zappers (the interesting ones) — cap at 30
  const multiMemberZappers = Array.from(zapperMembers.entries())
    .filter(([, memberSet]) => memberSet.size >= 2)
    .sort((a, b) => zapperSats.get(b[0])! - zapperSats.get(a[0])!)
    .slice(0, 30)
    .map(e => e[0]);

  // Top 3 single-member zappers per member
  const singleMemberZappers: string[] = [];
  for (const member of membersWithZaps) {
    const singles = (member.topZappers || [])
      .filter(z => (zapperMembers.get(z.pubkey)?.size || 0) === 1)
      .sort((a, b) => b.totalSats - a.totalSats)
      .slice(0, 3)
      .map(z => z.pubkey);
    singleMemberZappers.push(...singles);
  }

  const allZapperPubkeys = new Set([...multiMemberZappers, ...singleMemberZappers]);

  // Layout
  const memberCount = membersWithZaps.length;
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const memberRadius = 28;
  const zapperRadius = 8;

  const memberNodes: GraphNode[] = membersWithZaps.map((member, i) => {
    const angle = (i / memberCount) * Math.PI * 2;
    const dist = memberCount > 1 ? 40 : 0;
    return {
      id: member.pubkey,
      label: member.name,
      type: 'member',
      x: centerX + Math.cos(angle) * dist,
      y: centerY + Math.sin(angle) * dist,
      radius: memberRadius,
      color: MEMBER_COLOR,
      totalSats: member.totalEarnings,
      zapCount: member.totalZaps,
    };
  });

  const zapperList = Array.from(allZapperPubkeys);
  const zapperNodes: GraphNode[] = zapperList.map((pubkey, i) => {
    const angle = (i / zapperList.length) * Math.PI * 2;
    const ringRadius = Math.min(WIDTH, HEIGHT) * 0.4;
    const memberCount_ = zapperMembers.get(pubkey)?.size || 1;
    const hasPic = zapperPictures.has(pubkey);
    // Bigger radius if we have a picture to show
    const baseRadius = hasPic ? 14 : (memberCount_ > 1 ? zapperRadius + 3 : zapperRadius);
    return {
      // Prefixed id: a member can also be a zapper (e.g. the relay's own
      // key) and bare-pubkey ids then collide in React's key list.
      id: `zapper:${pubkey}`,
      label: zapperNames.get(pubkey) || '[Anonymous]',
      type: 'zapper',
      x: centerX + Math.cos(angle) * ringRadius,
      y: centerY + Math.sin(angle) * ringRadius,
      radius: baseRadius,
      color: memberCount_ > 1 ? MULTI_ZAPPER_COLOR : SINGLE_ZAPPER_COLOR,
      totalSats: zapperSats.get(pubkey) || 0,
      zapCount: zapperZaps.get(pubkey) || 0,
      memberCount: memberCount_,
      picture: zapperPictures.get(pubkey),
    };
  });

  // Build edges
  const edges: GraphEdge[] = [];
  for (const zapperPubkey of allZapperPubkeys) {
    const memberSet = zapperMembers.get(zapperPubkey);
    if (!memberSet) continue;
    for (const memberPubkey of memberSet) {
      const member = membersWithZaps.find(m => m.pubkey === memberPubkey);
      const zapper = member?.topZappers?.find(z => z.pubkey === zapperPubkey);
      if (zapper) {
        edges.push({
          source: `zapper:${zapperPubkey}`,
          target: memberPubkey,
          sats: zapper.totalSats,
          zapCount: zapper.zapCount,
        });
      }
    }
  }

  return { nodes: [...memberNodes, ...zapperNodes], edges };
}
