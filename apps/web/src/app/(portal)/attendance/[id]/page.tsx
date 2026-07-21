"use client";

import { AttendanceMarkingPanel } from "@/components/attendance-marking-panel";
import { useParams } from "next/navigation";

export default function AttendanceRosterPage() {
  const id = useParams<{ id: string }>().id;
  return <AttendanceMarkingPanel sessionId={id} />;
}
