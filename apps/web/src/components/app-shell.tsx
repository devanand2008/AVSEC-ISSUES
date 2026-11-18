"use client";

import {
  Bell,
  ChevronDown,
  CircleUserRound,
  FileWarning,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const [navigationQuery, setNavigationQuery] = useState("");
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sideNav = useRef<HTMLElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
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
  function closeNavigation() {
    setOpen(false);
    window.requestAnimationFrame(() => openButton.current?.focus());
  }
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
    if (!open && !profile) return;
    if (open) closeButton.current?.focus();
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (open) closeNavigation();
      else {
        setProfile(false);
        profileButton.current?.focus();
      }
    }
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open, profile]);
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 1001px)");
    function onResize(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, [open]);
  useEffect(() => {
    if (loading || !user) return;
    const frame = window.requestAnimationFrame(() => {
      const nav = sideNav.current;
      const active = nav?.querySelector<HTMLElement>("a.active");
      if (!nav || !active) return;
      const top = active.getBoundingClientRect().top - nav.getBoundingClientRect().top;
      if (top < 0 || top + active.offsetHeight > nav.clientHeight)
        nav.scrollTop += top - (nav.clientHeight - active.offsetHeight) / 2;
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
  const navQuery = navigationQuery.trim().toLowerCase();
  const matchingNav = nav.filter((item) => item.label.toLowerCase().includes(navQuery));
  const currentAnnouncement = pendingAnnouncements[0];
  return (
    <div className="app-frame">
      <a className={styles.skipLink} tabIndex={open ? -1 : undefined} href="#main-content">Skip to main content</a>
      <aside id="portal-sidebar" className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <CollegeBranding compact />
          <button
            className="sidebar-close"
            ref={closeButton}
            onClick={closeNavigation}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <label className={styles.navigationFilter}>
          <Search size={17} aria-hidden />
          <input
            type="search"
            aria-label="Filter navigation"
            placeholder="Find a page"
            value={navigationQuery}
            onChange={(event) => setNavigationQuery(event.target.value)}
          />
        </label>
        <nav ref={sideNav} className="side-nav" aria-label="Main navigation">
          {matchingNav.length === 0 && <p className={styles.noMatches} role="status">No matching pages</p>}
          {matchingNav.map((item) => {
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
                aria-current={active ? (pathname === item.href ? "page" : "location") : undefined}
                onClick={() => {
                  setNavigationQuery("");
                  if (open) closeNavigation();
                }}
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
          <Link href="/report-issue" className="btn" onClick={() => {
            if (open) closeNavigation();
          }}>
            <FileWarning size={18} aria-hidden />
            Report issue
          </Link>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={closeNavigation}
        />
      )}
      <div className="main-column" inert={open}>
        <header className="topbar">
          <button
            className="menu-button"
            ref={openButton}
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="portal-sidebar"
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
              ref={profileButton}
              onClick={() => setProfile(!profile)}
              aria-label={`Account menu for ${user.fullName}`}
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
              <div className="profile-popover card" onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) setProfile(false);
              }}>
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
        <main id="main-content" className="content" tabIndex={-1}>{children}</main>
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
