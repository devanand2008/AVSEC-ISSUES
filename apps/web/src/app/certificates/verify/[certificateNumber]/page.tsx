"use client";

import { useQuery } from "@tanstack/react-query";
import { Award, CheckCircle2, XCircle } from "lucide-react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

interface Verification {
  valid: true;
  certificateNumber: string;
  studentName: string;
  score: number;
  issuedAt: string;
  course: { code: string; title: string; college: { name: string } };
}

export default function CertificateVerificationPage() {
  const params = useParams<{ certificateNumber: string }>();
  const certificateNumber = params.certificateNumber;
  const query = useQuery({ queryKey: ["certificate-verification", certificateNumber], queryFn: () => api.get<Verification>(`/learn/certificates/verify/${encodeURIComponent(certificateNumber)}`), retry: false });
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "linear-gradient(145deg, #eff6ff, #fff7d6)" }}>
    <section className="card" style={{ width: "min(680px, 100%)", padding: 30, textAlign: "center" }}>
      <Image src="/images/avs-logo.png" width={92} height={92} alt="AVS Engineering College" style={{ objectFit: "contain" }} />
      <h1 style={{ marginTop: 14 }}>Certificate verification</h1>
      {query.isLoading ? <p className="muted">Checking the official AVS Learn record…</p> : query.isError || !query.data ? <div role="alert"><XCircle size={44} color="#dc2626" /><h2>Certificate not found</h2><p className="muted">Check the certificate ID or contact AVS Engineering College.</p></div> : <div>
        <CheckCircle2 size={48} color="#15803d" />
        <h2 style={{ color: "#15803d" }}>Valid AVS certificate</h2>
        <Award size={32} />
        <p>This certifies that <strong>{query.data.studentName}</strong> completed <strong>{query.data.course.title}</strong> ({query.data.course.code}).</p>
        <p>Score: <strong>{query.data.score}/100</strong> · Issued: <strong>{new Date(query.data.issuedAt).toLocaleDateString("en-IN")}</strong></p>
        <p className="muted">{query.data.course.college.name}<br />{query.data.certificateNumber}</p>
      </div>}
    </section>
  </main>;
}
