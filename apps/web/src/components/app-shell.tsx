"use client";

import {
  Bell,
  ChevronDown,
  CircleUserRound,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CollegeBranding, LoadingLogo } from "@/components/college-branding";
import { useAuth } from "@/providers/auth-provider";
import { GlobalSearch } from "@/components/global-search";
import {
  getActiveNavigationHref,
  visibleNavigation,
} from "@/components/navigation";
import { canAccessPortalPath } from "@/lib/portal-route-access";
import { api, apiEventUrl } from "@/lib/api";
import {
  AnnouncementModal,
  type PendingAnnouncement,
} from "@/components/announcement-modal";
import { MobileBottomNavigation } from "@/components/ui/mobile-bottom-navigation";
import { AvsBotWidget } from "@/components/avs-bot-widget";
import {
  compactBadgeCount,
  navigationBadgeCount,
  type NotificationSummary,
} from "@/features/shell/notification-summary";
import { requiresProfileSetup } from "@/features/auth/post-login-routing";
import styles from "./app-shell.module.css";
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pendingAnnouncements, setPendingAnnouncements] = useState<
    PendingAnnouncement[]
  >([]);
  const canReadNotifications = Boolean(
    user?.permissions.includes("notifications.read_own"),
  );
  const profileSetupRequired = Boolean(
    user && !user.mustChangePassword && requiresProfileSetup(user),
  );
  const onProfileSetupRoute = pathname === "/profile/setup";
  const notificationSummary = useQuery({
    queryKey: ["notification-summary"],
    queryFn: ({ signal }) =>
      api.get<NotificationSummary>("/notifications/summary", { signal }),
    enabled:
      !loading &&
      Boolean(user) &&
      !user?.mustChangePassword &&
      !profileSetupRequired &&
      canReadNotifications,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const routeAllowed =
    !user || canAccessPortalPath(pathname, user.permissions, user.roles);
  function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    setProfile(false);
    setOpen(false);
    void logout();
    router.replace("/login");
  }
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    else if (user?.status === "SUSPENDED" && pathname !== "/suspended")
      router.replace("/suspended");
    else if (user?.mustChangePassword && pathname !== "/change-password")
      router.replace("/change-password");
    else if (profileSetupRequired && !onProfileSetupRoute)
      router.replace("/profile/setup");
    else if (user && !routeAllowed) router.replace("/unauthorized");
  }, [
    loading,
    user,
    router,
    pathname,
    routeAllowed,
    profileSetupRequired,
    onProfileSetupRoute,
  ]);

  // Fetch pending announcements
  useEffect(() => {
    if (
      loading ||
      !user ||
      !routeAllowed ||
      user.mustChangePassword ||
      profileSetupRequired
    )
      return;
    if (
      ["/login", "/change-password", "/suspended", "/unauthorized"].includes(
        pathname,
      )
    )
      return;

    api
      .get<PendingAnnouncement[]>("/announcements/me/pending")
      .then((data) => {
        if (data && data.length > 0) {
          setPendingAnnouncements(data);
        }
      })
      .catch(console.error);
  }, [loading, user, routeAllowed, pathname, profileSetupRequired]);
  useEffect(() => {
    if (loading || !user || user.mustChangePassword || profileSetupRequired)
      return;
    const source = new EventSource(apiEventUrl("/announcements/stream"), {
      withCredentials: true,
    });
    source.onmessage = () => {
      api
        .get<PendingAnnouncement[]>("/announcements/me/pending")
        .then((data) => {
          if (data?.length) setPendingAnnouncements(data);
        })
        .catch(console.error);
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [loading, user, profileSetupRequired]);
  useEffect(() => {
    if (loading || !user) return;
    const frame = window.requestAnimationFrame(() => {
      const nav = document.querySelector<HTMLElement>(".side-nav");
      const active = document.querySelector<HTMLElement>(".side-nav a.active");
      if (!nav || !active) return;
      const top = active.offsetTop - nav.offsetTop;
      const centeredTop = top - (nav.clientHeight - active.clientHeight) / 2;
      nav.scrollTo({ top: Math.max(0, centeredTop), behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, pathname, user]);
  const redirectingToProfileSetup =
    profileSetupRequired && !onProfileSetupRoute;
  if (loading || !user || !routeAllowed || redirectingToProfileSetup)
    return (
      <div
        style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}
      >
        <LoadingLogo />
      </div>
    );
  const nav = visibleNavigation(user.permissions, user.roles);
  const activeNavigationHref = getActiveNavigationHref(pathname, nav);
  const currentAnnouncement = pendingAnnouncements[0];
  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <CollegeBranding compact />
          <button
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map((item) => {
            const active = item.href === activeNavigationHref;
            const Icon = item.icon;
            const badgeCount = navigationBadgeCount(
              item.href,
              notificationSummary.data,
            );
            return (
              <Link
                className={`${styles.navigationLink} ${active ? "active" : ""}`.trim()}
                href={item.href}
                key={item.href}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} />
                <span className={styles.navLabel}>{item.label}</span>
                {badgeCount != null && (
                  <span
                    className={`${styles.counterBadge} ${
                      item.href === "/admin/escalation" ||
                      (item.href === "/issues" &&
                        notificationSummary.data?.overdueIssues)
                        ? styles.criticalCounter
                        : ""
                    }`}
                    aria-label={`${badgeCount} ${item.label.toLowerCase()}`}
                  >
                    {compactBadgeCount(badgeCount)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-help">
          <span className="eyebrow" style={{ color: "#93c5fd" }}>
            Campus services
          </span>
          <strong>Spot a problem?</strong>
          <span>Report it in under a minute.</span>
          <Link
            href="/report-issue"
            className="btn"
            style={{ background: "white", color: "#1e3a8a" }}
          >
            Report issue
          </Link>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div className="mobile-topbar-brand">
            <CollegeBranding compact />
          </div>
          <GlobalSearch />
          {canReadNotifications && (
            <Link
              href="/notifications"
              className={`icon-button ${styles.notificationButton}`}
              aria-label={
                notificationSummary.data?.unread
                  ? `Notifications, ${notificationSummary.data.unread} unread`
                  : "Notifications"
              }
            >
              <Bell size={20} />
              {Boolean(notificationSummary.data?.unread) && (
                <span className={styles.topbarBadge} aria-hidden="true">
                  {compactBadgeCount(notificationSummary.data!.unread)}
                </span>
              )}
            </Link>
          )}
          <div className="profile-menu">
            <button
              className="profile-button"
              onClick={() => setProfile(!profile)}
              aria-expanded={profile}
            >
              <span className="avatar">
                {user.fullName
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="profile-copy">
                <strong>{user.fullName}</strong>
                <small>{user.roles[0]?.replaceAll("_", " ") ?? "Member"}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {profile && (
              <div className="profile-popover card">
                <Link href="/profile">
                  <CircleUserRound size={17} />
                  Profile
                </Link>
                <Link href="/security">
                  <Settings size={17} />
                  Security & sessions
                </Link>
                {canReadNotifications && (
                  <Link href="/settings/notifications">
                    <Bell size={17} />
                    Notification settings
                  </Link>
                )}
                <button
                  aria-busy={signingOut}
                  disabled={signingOut}
                  type="button"
                  onClick={() => void handleLogout()}
                >
                  <LogOut size={17} />
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
        {!profileSetupRequired &&
          user.permissions.includes("ai.use") &&
          pathname !== "/avs-bot" && <AvsBotWidget />}
        {!profileSetupRequired && <MobileBottomNavigation />}
      </div>

      {/* Announcements Auto-Display Popup */}
      {currentAnnouncement && (
        <AnnouncementModal
          key={currentAnnouncement.id}
          announcement={currentAnnouncement}
          onClose={() => setPendingAnnouncements((prev) => prev.slice(1))}
        />
      )}
    </div>
  );
}
