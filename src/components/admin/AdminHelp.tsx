import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Eye,
  Lock,
  Zap,
  MessageCircle,
  Calendar,
  Rss,
  FileText,
  FileCode,
  FileImage,
  Database,
  RefreshCw,
  Clock,
  ClipboardList,
  LayoutDashboard,
  Users,
  UserRoundCog,
  Bot,
  ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { isUnifiedSetup } from '@/lib/relay';

export default function AdminHelp() {
  const unified = isUnifiedSetup();

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <HelpCircle className="h-8 w-8 text-primary" />
          Admin Help & Access Control
        </h2>
        <p className="text-muted-foreground">
          Detailed guide on user permissions, content visibility, and admin features.
        </p>
      </div>

      {/* Role Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-purple-600" />
              Master User
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Absolute ownership. Can manage roles, relays, site settings, and system settings.</p>
          </CardContent>
        </Card>

        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              Primary Admin (Publisher)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Trusted moderator. Content is published live immediately to the public site. Can view community zaplytics.</p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-600" />
              Secondary Admin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Contributor. Can create content, but it requires role promotion to appear publicly.</p>
          </CardContent>
        </Card>

        <Card className="border-slate-500/20 bg-slate-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <User className="h-4 w-4 text-slate-600" />
              Unassigned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Registered user. Can access the admin panel but has no public publishing rights.</p>
          </CardContent>
        </Card>
      </div>

      {/* Permissions Matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Permissions Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto border rounded-lg">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 border-b">
                <tr>
                  <th className="px-4 py-3 font-semibold">Feature / Action</th>
                  <th className="px-4 py-3 text-center border-l">Master</th>
                  <th className="px-4 py-3 text-center border-l">Primary</th>
                  <th className="px-4 py-3 text-center border-l">Secondary</th>
                  <th className="px-4 py-3 text-center border-l">Unassigned</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* System Settings */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Lock className="h-4 w-4 text-orange-500" />
                    Site & Admin Settings
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Manage & Save</Badge>
                  </td>
                  <td className="px-4 py-4 text-center border-l" colSpan={3}>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1.5 text-xs text-orange-600">
                        <Eye className="h-3.5 w-3.5" />
                        <span>View Only*</span>
                      </div>
                    </div>
                  </td>
                </tr>

                {/* Feed Management */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Rss className="h-4 w-4 text-orange-500" />
                    Manage Feed Sources
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                </tr>

                {/* Zaplytics */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    Zaplytics (Individual)
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    Zaplytics (Community)
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                </tr>

                {/* Relay Explorer */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Database className="h-4 w-4 text-indigo-500" />
                    Relay Explorer
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l" colSpan={3}>
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                </tr>

                {/* Sync Content */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <RefreshCw className="h-4 w-4 text-cyan-500" />
                    Sync Content
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                </tr>

                {/* Follow Backup */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Users className="h-4 w-4 text-teal-500" />
                    Follow Backup
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                </tr>

                {/* Manage Relay Access — hidden unless CMS and relay share a domain */}
                {unified && (
                  <tr>
                    <td className="px-4 py-4 flex items-center gap-2 font-medium">
                      <Shield className="h-4 w-4 text-purple-500" />
                      Manage Relay Access
                    </td>
                    <td className="px-4 py-4 text-center border-l">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                    </td>
                    <td className="px-4 py-4 text-center border-l" colSpan={3}>
                      <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                    </td>
                  </tr>
                )}

                {/* Content Creation */}
                {[
                  { name: 'Events', icon: Calendar, color: 'text-blue-500' },
                  { name: 'Blog Posts', icon: FileText, color: 'text-indigo-500' },
                  { name: 'Notes (Kind 1)', icon: MessageCircle, color: 'text-pink-500' },
                  { name: 'Static Pages', icon: FileCode, color: 'text-cyan-500' },
                  { name: 'Forms', icon: ClipboardList, color: 'text-orange-500' },
                  { name: 'Media Upload', icon: FileImage, color: 'text-green-500' },
                ].map((item) => (
                  <tr key={item.name}>
                    <td className="px-4 py-4 flex items-center gap-2 font-medium">
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                      {item.name}
                    </td>
                    <td className="px-4 py-4 text-center border-l">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                    </td>
                    <td className="px-4 py-4 text-center border-l">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                    </td>
                    <td className="px-4 py-4 text-center border-l group" colSpan={2}>
                      <div className="flex items-center justify-center gap-1.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/20 py-1 px-3 rounded-full mx-auto w-fit">
                        <Shield className="h-3.5 w-3.5" />
                        <span>Approval Required**</span>
                      </div>
                    </td>
                  </tr>
                ))}

                {/* Media Delete */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <FileImage className="h-4 w-4 text-red-500" />
                    Delete Media
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                </tr>

                {/* Notes Feed Visibility */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <MessageCircle className="h-4 w-4 text-pink-500" />
                    Notes Feed Visibility
                  </td>
                  <td className="px-4 py-4 text-center border-l text-xs">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l text-xs" colSpan={3}>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-pink-600 bg-pink-50 dark:bg-pink-900/20 py-1 px-3 rounded-full mx-auto w-fit">
                      <Zap className="h-3.5 w-3.5" />
                      <span>Whitelist Only***</span>
                    </div>
                  </td>
                </tr>

                {/* Reset to Defaults */}
                <tr>
                  <td className="px-4 py-4 flex items-center gap-2 font-medium">
                    <Zap className="h-4 w-4 text-red-500" />
                    Reset to Defaults
                  </td>
                  <td className="px-4 py-4 text-center border-l">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                  </td>
                  <td className="px-4 py-4 text-center border-l" colSpan={3}>
                    <XCircle className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-6 space-y-4 text-sm text-muted-foreground border-t pt-6">
            <p>
              <span className="font-bold text-foreground">* View Only Access:</span> Non-master admins can only see Site and Admin settings if
              <span className="font-bold text-foreground italic px-1">"Read-Only Admin Access"</span> is enabled in
              <Link to="/admin/system-settings" className="text-primary hover:underline inline-flex items-center gap-1 ml-1">
                Admin Settings <ExternalLink className="h-3 w-3" />
              </Link>.
            </p>
            <p>
              <span className="font-bold text-foreground">** Approval Required:</span> Content from Secondary or Unassigned users is published to relays but
              remains hidden from the public site. To "approve" their content, a Master User or Primary Admin must promote the user to a
              <span className="text-green-600 font-bold px-1">Primary Admin</span> role in Admin Settings.
            </p>
            <p>
              <span className="font-bold text-foreground">*** Whitelist Only:</span> The public site's Note Feed only displays Kind 1 events from npubs specifically
              listed in the <span className="font-bold text-foreground italic px-1">Feed Settings</span> tab. Add npubs there to include their notes in the feed.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Admin Tabs Guide */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Tabs Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { icon: LayoutDashboard, name: 'Dashboard', desc: 'Overview of your site: recent events, blog posts, notes, and quick stats.' },
            { icon: Bot, name: 'AI Helper', desc: 'Chat with an OpenAI-compatible LLM provider. Appears once an API key is saved in Admin Settings → AI Assistant, or when the master user shares it with all admins via a server-side key.' },
            { icon: MessageCircle, name: 'Notes', desc: 'Create and manage short-form Nostr notes (Kind 1). Search notes by content. Published notes appear on the homepage feed if enabled.' },
            { icon: FileText, name: 'Blog Posts', desc: 'Create and manage long-form blog posts (Kind 30023). Filter by published/drafts. Search by username.' },
            { icon: Clock, name: 'Scheduled', desc: 'View and manage scheduled content posts that will be published automatically at a future time. Appears only when the scheduler is running.' },
            { icon: FileImage, name: 'Media', desc: 'Upload and manage media files (images, videos) stored via Blossom on your relay. Copy media URLs for use in posts and pages. All admins can upload; delete is Master/Publisher only.' },
            { icon: Zap, name: 'Zaplytics', desc: 'Analyze zap (Bitcoin Lightning) earnings. Individual tab shows personal earnings. Community tab (Master/Publisher only) shows aggregate stats with time ranges and visualizations.' },
            { icon: Calendar, name: 'Events', desc: 'Create and manage calendar events (Kind 31922/31923) with RSVPs. Search by username. Only events from Master/Publisher users appear on the public site.' },
            { icon: ClipboardList, name: 'Forms', desc: 'Create custom forms (Kind 34127) for registrations, surveys, and contact. View form responses.' },
            { icon: FileCode, name: 'Pages', desc: 'Create static pages (Kind 34128) with markdown or HTML content. Each page has a path (e.g. /about) that can be linked in the navigation menu.' },
            { icon: Database, name: 'Relay Explorer', desc: 'Browse raw Nostr events stored on your relay. Master user only. Inspect event kinds, tags, and content directly.' },
            { icon: RefreshCw, name: 'Sync Content', desc: 'Backfill events from external relays into your local relay using paginated sync. Useful for migrating content from another relay. Available to all admins.' },
            { icon: Users, name: 'Follow Backup', desc: 'Back up, restore, and recover your Nostr follow list (Kind 3). Create encrypted backups on the relay, export to a JSON file, recover from other relays or the relay archive, and sync your current list to other relays. Available to all logged-in users.' },
            ...(unified ? [{ icon: UserRoundCog, name: 'Manage Relay Access', desc: 'Manage who can publish to your relay. Add or remove pubkeys from the relay access list. Master user only, on unified setups.' }] : []),
            { icon: Rss, name: 'Feed Settings', desc: 'Configure the community feed sources. Add npubs manually or from your nostr.json directory. Toggle reading from publish relays. Enable showing the feed on the homepage.' },
            { icon: Shield, name: 'Site Settings', desc: 'Configure your site: title, logo, hero section (title, subtitle, background type, banner, text color), navigation menu, content display toggles (events, blog, feed), and hero buttons.' },
            { icon: Lock, name: 'Admin Settings', desc: 'System-level settings: admin roles, relay configuration, read-only admin access toggle, and reset to defaults. Master user only.' },
          ].map((item) => (
            <div key={item.name} className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
              <item.icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">{item.name}</p>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Site Settings Guide */}
      <Card>
        <CardHeader>
          <CardTitle>Site Settings Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <p className="font-bold text-foreground mb-1">Hero Section</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><span className="font-medium text-foreground">Banner Image</span> — Optional image shown between the navigation bar and the hero section. Tall images are height-capped (400px) with color-matched blurred fill on the sides.</li>
              <li><span className="font-medium text-foreground">Background Type</span> — Choose "None" (transparent, default), "Background Image" (image with dark overlay), or "Solid Color" (color picker).</li>
              <li><span className="font-medium text-foreground">Text Color</span> — Pick a color for the hero title, subtitle, and outline buttons. Defaults to black for light backgrounds. Use white for dark/image backgrounds.</li>
              <li><span className="font-medium text-foreground">Hero Buttons</span> — Up to 6 call-to-action buttons with label, link, and style (filled or outline). Disabled buttons (empty label/href) are hidden.</li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-foreground mb-1">Navigation Menu</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Drag-and-drop reordering with submenu support.</li>
              <li><span className="font-medium text-foreground">Add built-in</span> dropdown — quickly add Feed, Blog, Events, About, or Contact with correct paths pre-filled.</li>
              <li><span className="font-medium text-foreground">Custom</span> button — add a nav item with any name and path. Link it to a static page created in the Pages tab.</li>
              <li><span className="font-medium text-foreground">Label Only</span> toggle — make a nav item a non-clickable header for grouping submenu items.</li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-foreground mb-1">Content Display</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><span className="font-medium text-foreground">Show Events on Homepage</span> — Toggle upcoming events section (default: on).</li>
              <li><span className="font-medium text-foreground">Show Blog Posts on Homepage</span> — Toggle recent blog posts section (default: on).</li>
              <li><span className="font-medium text-foreground">Show Feed on Homepage</span> — Toggle community feed notes section (default: off). Requires feed npubs to be configured in Feed Settings.</li>
              <li>Set maximum items to display for each section.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Footer Note */}
      <div className="p-4 rounded-lg bg-primary/5 border border-primary/10 text-center">
        <p className="text-sm text-muted-foreground">
          Permissions are enforced both in the Admin UI (hidden buttons) and in the public site logic (content filtering).
        </p>
      </div>
    </div>
  );
}
