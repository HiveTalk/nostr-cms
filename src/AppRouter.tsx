import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

// Admin pages
import AdminWrapper from "./pages/admin/AdminWrapper";
import AdminPage from "./pages/admin/AdminPage";
import AdminNotesPage from "./pages/admin/AdminNotesPage";
import AdminBlogPage from "./pages/admin/AdminBlogPage";
import AdminEventsPage from "./pages/admin/AdminEventsPage";
import AdminFeedPage from "./pages/admin/AdminFeedPage";
import AdminZaplyticsPage from "./pages/admin/AdminZaplyticsPage";
import AdminPagesPage from "./pages/admin/AdminPagesPage";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import AdminSystemSettingsPage from "./pages/admin/AdminSystemSettingsPage";
import AdminMediaPage from "./pages/admin/AdminMediaPage";
import AdminProfilePage from "./pages/admin/AdminProfilePage";
import AdminLoginPage from "./pages/admin/AdminLoginPage";
import AdminHelpPage from "./pages/admin/AdminHelpPage";
import AdminScheduledPage from "./pages/admin/AdminScheduledPage";
import AdminFormsPage from "./pages/admin/AdminFormsPage";
import AdminSyncPage from "./pages/admin/AdminSyncPage";
import AdminRelayAccessPage from "./pages/admin/AdminRelayAccessPage";
import AdminAiChatPage from "./pages/admin/AdminAiChatPage";
import AdminExplorerPage from "./pages/admin/AdminExplorerPage";
import AdminFollowBackupPage from "./pages/admin/AdminFollowBackupPage";
import AdminCrosspostPage from "./pages/admin/AdminCrosspostPage";

// Public pages
import EventsPage from "./pages/EventsPage";
import EventPage from "./pages/EventPage";
import BlogPage from "./pages/BlogPage";
import BlogPostPage from "./pages/BlogPostPage";
import FeedPage from "./pages/FeedPage";
import StaticPage from "./pages/StaticPage";
import ProfilePage from "./pages/ProfilePage";
import FormPage from "./pages/FormPage";
import FormOrStaticPage from "./pages/FormOrStaticPage";

function AdminRoutes() {
  return <AdminWrapper />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        {/* Public routes */}
        <Route path="/events" element={<EventsPage />} />
        <Route path="/event/:eventId" element={<EventPage />} />
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/blog/:postId" element={<BlogPostPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route
          path="/:nip19(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)"
          element={<NIP19Page />}
        />
        {/* Static pages (about, contact, etc.) */}
        <Route path="/about" element={<StaticPage pathOverride="/about" />} />
        <Route path="/contact" element={<StaticPage pathOverride="/contact" />} />
        <Route path="/p/:path" element={<StaticPage />} />

        {/* Form routes */}
        <Route path="/form/:formId" element={<FormPage />} />

        {/* Admin routes */}
        <Route path="/admin" element={<AdminRoutes />}>
          <Route index element={<AdminPage />} />
          <Route path="ai" element={<AdminAiChatPage />} />
          <Route path="notes" element={<AdminNotesPage />} />
          <Route path="blog" element={<AdminBlogPage />} />
          <Route path="scheduled" element={<AdminScheduledPage />} />
          <Route path="events" element={<AdminEventsPage />} />
          <Route path="feed" element={<AdminFeedPage />} />
          <Route path="zaplytics" element={<AdminZaplyticsPage />} />
          <Route path="pages" element={<AdminPagesPage />} />
          <Route path="forms" element={<AdminFormsPage />} />
          <Route path="sync-content" element={<AdminSyncPage />} />
          <Route path="crosspost" element={<AdminCrosspostPage />} />
          <Route path="follow-backup" element={<AdminFollowBackupPage />} />
          <Route path="relay-access" element={<AdminRelayAccessPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="system-settings" element={<AdminSystemSettingsPage />} />
          <Route path="media" element={<AdminMediaPage />} />
          <Route path="explorer" element={<AdminExplorerPage />} />
          <Route path="follow-backup" element={<AdminFollowBackupPage />} />
          <Route path="profile" element={<AdminProfilePage />} />
          <Route path="help" element={<AdminHelpPage />} />
        </Route>
        <Route path="/admin/login" element={<AdminLoginPage />} />

        {/* Dynamic Static Pages or LinkedForms (catch-all for routes not matched above) */}
        <Route path="/:path" element={<FormOrStaticPage />} />

        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
