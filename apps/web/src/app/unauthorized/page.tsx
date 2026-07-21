"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: "50%", background: "#fff1f2", color: "#dc2626", marginBottom: 20 }}>
          <ShieldAlert size={32} />
        </span>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Access denied</h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
          You do not have permission to access this page. If you believe this is an error, contact your college administrator or request the appropriate role.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/" className="btn btn-primary">Go to dashboard</Link>
          <Link href="/profile" className="btn btn-secondary">My profile</Link>
        </div>
      </div>
    </div>
  );
}
