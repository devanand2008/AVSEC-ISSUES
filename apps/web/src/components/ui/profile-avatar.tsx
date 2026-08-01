"use client";

interface ProfileAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  status?: "active" | "suspended" | "archived" | "pending";
}

const sizeClass = { sm: "avs-avatar-sm", md: "avs-avatar", lg: "avs-avatar-lg", xl: "avs-avatar-xl" };

const statusDot: Record<string, string> = {
  active: "var(--avs-success)",
  suspended: "var(--avs-warning)",
  archived: "var(--avs-text-disabled)",
  pending: "var(--avs-info)",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0) ?? "AV";
  const last = parts.at(-1) ?? first;
  if (parts.length <= 1) return first.slice(0, 2).toUpperCase();
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}

export function ProfileAvatar({ name, photoUrl, size = "md", status }: ProfileAvatarProps) {
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <div className={sizeClass[size]} aria-label={name}>
        {photoUrl ? (
          // Backend-authorized file URLs can be short-lived and are intentionally
          // rendered directly rather than sent through the Next image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={name} />
        ) : (
          initials(name)
        )}
      </div>
      {status && (
        <span
          style={{
            position: "absolute",
            bottom: -1,
            right: -1,
            width: size === "sm" ? 8 : 10,
            height: size === "sm" ? 8 : 10,
            borderRadius: "var(--radius-full)",
            background: statusDot[status] ?? "var(--avs-text-disabled)",
            border: "2px solid var(--avs-card)",
          }}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
}
