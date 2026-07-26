"use client";

import {
  Bell,
  ChevronDown,
  CircleUserRound,
  ClipboardCheck,
  FileWarning,
  Gauge,
  LogOut,
  Menu,
  QrCode,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CollegeBranding, LoadingLogo } from "@/components/college-branding";
import { useAuth } from "@/providers/auth-provider";
import { GlobalSearch } from "@/components/global-search";
import { navigation, visibleNavigation } from "@/components/navigation";
import { canAccessPortalPath } from "@/lib/portal-route-access";
import { api, apiEventUrl } from "@/lib/api";
import { AnnouncementModal, type PendingAnnouncement } from "@/components/announcement-modal";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pendingAnnouncements, setPendingAnnouncements] = useState<PendingAnnouncement[]>([]);
  const routeAllowed =
    !user || canAccessPortalPath(pathname, user.permissions, user.roles);
  const isProfileVerificationExempt = Boolean(
    user?.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role)),
  );
  const profileRestricted = Boolean(
    user &&
      !isProfileVerificationExempt &&
      ["NOT_STARTED", "IN_PROGRESS", "REJECTED", "SUBMITTED"].includes(
        user.profileCompletionStatus ?? "NOT_STARTED",
      ),
  );
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
    else if (
      user &&
      !user.mustChangePassword &&
      profileRestricted &&
      pathname !== "/profile/setup"
    )
      router.replace("/profile/setup");
    else if (
      user &&
      !profileRestricted &&
      pathname === "/profile/setup"
    )
      router.replace("/");
    else if (user && !routeAllowed) router.replace("/unauthorized");
  }, [loading, user, router, pathname, routeAllowed, profileRestricted]);
  
  // Fetch pending announcements
  useEffect(() => {
    if (loading || !user || !routeAllowed || user.mustChangePassword || profileRestricted) return;
    if (["/login", "/change-password", "/suspended", "/unauthorized"].includes(pathname)) return;
    
    api.get<PendingAnnouncement[]>("/announcements/me/pending")
      .then(data => {
        if (data && data.length > 0) {
          setPendingAnnouncements(data);
        }
      })
      .catch(console.error);
  }, [loading, user, routeAllowed, pathname, profileRestricted]);
  useEffect(() => {
    if (loading || !user || user.mustChangePassword || profileRestricted) return;
    const source = new EventSource(apiEventUrl("/announcements/stream"), { withCredentials: true });
    source.onmessage = () => {
      api.get<PendingAnnouncement[]>("/announcements/me/pending")
        .then((data) => {
          if (data?.length) setPendingAnnouncements(data);
        })
        .catch(console.error);
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [loading, user, profileRestricted]);
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
  if (loading || !user || !routeAllowed)
    return (
      <div
        style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}
      >
        <LoadingLogo />
      </div>
    );
  const nav = visibleNavigation(user.permissions, user.roles);
  const canUseAttendance =
    navigation
      .find((item) => item.href === "/attendance")
      ?.any?.some((permission) => user.permissions.includes(permission)) ??
    false;
  const canReportIssue = user.permissions.includes("issues.create");
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
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                className={active ? "active" : ""}
                href={item.href}
                key={item.href}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
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
          <Link
            href="/notifications"
            className="icon-button"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </Link>
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
        <nav className="bottom-nav" aria-label="Mobile navigation">
          <Link href="/">
            <Gauge />
            <span>Home</span>
          </Link>
          {canUseAttendance ? (
            <Link href="/attendance">
              <ClipboardCheck />
              <span>Attendance</span>
            </Link>
          ) : (
            <Link href="/issues">
              <FileWarning />
              <span>Issues</span>
            </Link>
          )}
          <Link href="/scan-qr" className="report-tab" aria-label="Scan QR">
            <span>
              <QrCode />
            </span>
            <small>Scan QR</small>
          </Link>
          {canReportIssue ? (
            <Link href="/report-issue">
              <FileWarning />
              <span>Report</span>
            </Link>
          ) : (
            <Link href="/notifications">
              <Bell />
              <span>Alerts</span>
            </Link>
          )}
          <Link href="/profile">
            <CircleUserRound />
            <span>Profile</span>
          </Link>
        </nav>
      </div>

      {/* Announcements Auto-Display Popup */}
      {currentAnnouncement && (
        <AnnouncementModal
          key={currentAnnouncement.id}
          announcement={currentAnnouncement}
          onClose={() => setPendingAnnouncements(prev => prev.slice(1))}
        />
      )}
    </div>
  );
}
