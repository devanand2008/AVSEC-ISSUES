"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileWarning,
  Gauge,
  MessageCircle,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  getMobileBottomNav,
  isMobileNavigationItemActive,
  type BottomNavItem,
} from "@/components/navigation";
import { useAuth } from "@/providers/auth-provider";

const iconMap: Record<BottomNavItem["iconName"], LucideIcon> = {
  home: Gauge,
  attendance: ClipboardCheck,
  learn: BookOpen,
  messages: MessageCircle,
  people: Users,
  issues: FileWarning,
  reports: Download,
  profile: User,
  assigned: ClipboardList,
  more: Gauge,
};

export function MobileBottomNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  if (!user) return null;

  // Do not render bottom nav on authentication pages
  if (["/login", "/change-password", "/suspended", "/unauthorized"].includes(pathname)) {
    return null;
  }

  const items = getMobileBottomNav(user.roles, user.permissions);

  return (
    <nav className="avs-bottom-nav" aria-label="Mobile bottom navigation">
      {items.map((item) => {
        const Icon = iconMap[item.iconName] ?? Gauge;
        const isActive = isMobileNavigationItemActive(
          item.href,
          pathname,
          searchParams,
        );

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`avs-bottom-nav-item ${isActive ? "active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={22} aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
