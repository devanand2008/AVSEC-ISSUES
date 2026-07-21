"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Database, HardDrive, Server, Users, Zap } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api } from "@/lib/api";

interface HealthData {
  database: { status: string; activeUsers: number; totalIssues: number; activeSessions: number };
  jobs: { pendingFailures: number };
  escalations: { last24h: number };
  storage: { endpoint: string; configured: boolean };
  server: { nodeVersion: string; uptime: number; memoryMB: number };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function SystemHealthPage() {
  const health = useQuery({ queryKey: ["system-health"], queryFn: () => api.get<HealthData>("/system-health"), refetchInterval: 30000 });

  if (health.isLoading) return <LoadingState />;
  if (health.isError) return <ErrorState message="System health data could not be loaded." />;

  const data = health.data!;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Administration</span><h1 className="page-title" style={{ marginTop: 6 }}>System health</h1><p className="page-subtitle">Real-time infrastructure status and resource monitoring. Auto-refreshes every 30 seconds.</p></div></div>

    <section className="metric-grid" style={{ marginBottom: 18 }}>
      <article className="card metric-card"><span className="metric-icon" style={{ color: data.database.status === "connected" ? "#16a34a" : "#dc2626", background: data.database.status === "connected" ? "#f0fdf4" : "#fff1f2" }}><Database size={21} /></span><div><span className="muted">Database</span><strong style={{ textTransform: "capitalize" }}>{data.database.status}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#6366f1", background: "#eef2ff" }}><Users size={21} /></span><div><span className="muted">Active users</span><strong>{data.database.activeUsers}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: "#2563eb", background: "#eff6ff" }}><Activity size={21} /></span><div><span className="muted">Active sessions</span><strong>{data.database.activeSessions}</strong></div></article>
      <article className="card metric-card"><span className="metric-icon" style={{ color: data.jobs.pendingFailures > 0 ? "#d97706" : "#16a34a", background: data.jobs.pendingFailures > 0 ? "#fff7ed" : "#f0fdf4" }}><Zap size={21} /></span><div><span className="muted">Pending job failures</span><strong>{data.jobs.pendingFailures}</strong></div></article>
    </section>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
      <section className="card">
        <div className="section-head"><div><h2><Server size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Server</h2><p>Node.js runtime information</p></div></div>
        <dl className="detail-list">
          <div><dt>Node version</dt><dd>{data.server.nodeVersion}</dd></div>
          <div><dt>Uptime</dt><dd>{formatUptime(data.server.uptime)}</dd></div>
          <div><dt>Memory usage</dt><dd>{data.server.memoryMB} MB</dd></div>
        </dl>
      </section>

      <section className="card">
        <div className="section-head"><div><h2><Database size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Database</h2><p>PostgreSQL statistics</p></div></div>
        <dl className="detail-list">
          <div><dt>Connection</dt><dd><span className="badge badge-success">{data.database.status}</span></dd></div>
          <div><dt>Active users</dt><dd>{data.database.activeUsers}</dd></div>
          <div><dt>Total issues</dt><dd>{data.database.totalIssues}</dd></div>
          <div><dt>Active sessions</dt><dd>{data.database.activeSessions}</dd></div>
        </dl>
      </section>

      <section className="card">
        <div className="section-head"><div><h2><HardDrive size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Object storage</h2><p>S3-compatible file storage</p></div></div>
        <dl className="detail-list">
          <div><dt>Endpoint</dt><dd className="muted">{data.storage.endpoint || "Not configured"}</dd></div>
          <div><dt>Bucket</dt><dd>{data.storage.configured ? <span className="badge badge-success">Configured</span> : <span className="badge badge-warning">Not configured</span>}</dd></div>
        </dl>
      </section>

      <section className="card">
        <div className="section-head"><div><h2><AlertTriangle size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Escalations</h2><p>SLA breach monitoring</p></div></div>
        <dl className="detail-list">
          <div><dt>Last 24 hours</dt><dd style={data.escalations.last24h > 0 ? { color: "var(--error)", fontWeight: 600 } : {}}>{data.escalations.last24h}</dd></div>
          <div><dt>Pending failures</dt><dd style={data.jobs.pendingFailures > 0 ? { color: "var(--warning)", fontWeight: 600 } : {}}>{data.jobs.pendingFailures}</dd></div>
        </dl>
      </section>
    </div>

    <section className="card" style={{ marginTop: 18 }}>
      <div className="section-head"><div><h2>Backup information</h2><p>Database backup and recovery guidance</p></div></div>
      <div style={{ padding: "0 20px 20px", lineHeight: 1.7, color: "var(--text-secondary)" }}>
        <p><strong>PostgreSQL backups</strong> are managed via Docker volumes and <code>pg_dump</code>. For production deployments:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Use <code>docker exec -it postgres pg_dump -U postgres college_management &gt; backup.sql</code> for manual backups</li>
          <li>Configure automated pg_dump via cron or a dedicated backup service</li>
          <li>Object storage (MinIO/S3) files are persisted in the configured bucket</li>
          <li>Redis data is ephemeral and regenerated from the database on restart</li>
        </ul>
        <p>See <a href="https://github.com" style={{ color: "var(--primary)" }}>BACKUP_RESTORE.md</a> for the full recovery runbook.</p>
      </div>
    </section>
  </>;
}
