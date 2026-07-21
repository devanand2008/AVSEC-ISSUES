"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, FileWarning, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { api } from "@/lib/api";

interface SearchResults {
  rooms: Array<{ id: string; code: string; name: string; floor: { id: string; block: { id: string; campusId: string } } }>;
  issues: Array<{ id: string; issueNumber: string; title: string; status: string }>;
  users: Array<{ publicId: string; collegeIdentityId: string; fullName: string; status: string }>;
}

export function GlobalSearch() {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const query = useDeferredValue(value.trim());
  const results = useQuery({ queryKey: ["global-search", query], queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`), enabled: query.length >= 2, staleTime: 20_000 });
  const total = results.data ? results.data.rooms.length + results.data.issues.length + results.data.users.length : 0;
  const open = focused && value.trim().length >= 2;
  return <div className="topbar-search" style={{ position: "relative" }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Search size={18} className="muted" /><input aria-label="Search rooms, issues and people" placeholder="Search rooms, issues or people" value={value} onFocus={() => setFocused(true)} onChange={(event) => { setValue(event.target.value); setFocused(true); }} />{value && <button className="icon-button" aria-label="Clear search" onClick={() => setValue("")}><X size={15} /></button>}
    {open && <div className="card" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, minWidth: 320, maxHeight: "min(70vh, 520px)", overflowY: "auto", padding: 10, zIndex: 30 }}>
      {results.isLoading ? <div className="empty">Searching…</div> : results.isError ? <div className="error-box">Search is temporarily unavailable.</div> : total === 0 ? <div className="empty">No scoped results found.</div> : <div className="issue-list">
        {results.data?.issues.map((issue) => <Link href={`/issues/${issue.id}`} onClick={() => setFocused(false)} key={issue.id}><span className="list-icon"><FileWarning size={17} /></span><span className="list-copy"><strong>{issue.title}</strong><small>{issue.issueNumber} · {issue.status.replaceAll("_", " ")}</small></span></Link>)}
        {results.data?.rooms.map((room) => <Link href={`/report-issue?campusId=${room.floor.block.campusId}&blockId=${room.floor.block.id}&floorId=${room.floor.id}&roomId=${room.id}`} onClick={() => setFocused(false)} key={room.id}><span className="list-icon"><Building2 size={17} /></span><span className="list-copy"><strong>{room.name}</strong><small>{room.code} · Report an issue here</small></span></Link>)}
        {results.data?.users.map((person) => <Link href="/admin/users" onClick={() => setFocused(false)} key={person.publicId}><span className="list-icon"><UserRound size={17} /></span><span className="list-copy"><strong>{person.fullName}</strong><small>{person.collegeIdentityId} · {person.status}</small></span></Link>)}
      </div>}
    </div>}
  </div>;
}
