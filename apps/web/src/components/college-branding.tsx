import Image from "next/image";

export const collegeBranding = {
  collegeName: "AVS Engineering College",
  appName: "Campus Management System",
  logo: "/images/avs-logo-360.png",
};

export function CollegeLogo({
  size = 44,
  priority = false,
  className = "",
}: {
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`college-logo ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={collegeBranding.logo}
        alt="AVS Engineering College logo"
        width={size}
        height={size}
        priority={priority}
      />
    </span>
  );
}

export function CollegeBranding({
  compact = false,
  priority = false,
  className = "",
}: {
  compact?: boolean;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`college-branding ${compact ? "college-branding-compact" : ""} ${className}`}
    >
      <CollegeLogo size={compact ? 38 : 48} priority={priority} />
      <span className="college-branding-copy">
        <strong>{collegeBranding.collegeName}</strong>
        {!compact && <small>{collegeBranding.appName}</small>}
      </span>
    </div>
  );
}

export function LoadingLogo() {
  return (
    <div className="loading-logo" aria-label="Loading AVS Engineering College">
      <CollegeLogo size={72} priority />
      <strong>{collegeBranding.collegeName}</strong>
      <span>{collegeBranding.appName}</span>
      <i />
    </div>
  );
}
