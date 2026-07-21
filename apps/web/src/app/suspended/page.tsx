"use client";

import { Ban } from "lucide-react";
import Link from "next/link";

export default function SuspendedPage() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: "50%", background: "#fff7ed", color: "#d97706", marginBottom: 20 }}>
          <Ban size={32} />
        </span>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Account suspended</h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
          Your account has been suspended by an administrator. You cannot access the platform until the suspension is lifted. If you believe this is an error, please contact your college administration office.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/login" className="btn btn-primary">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
