"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus, Users, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError } from "@/lib/api";
import type { SelectOption } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

interface Team extends SelectOption { code: string; isDefaultMaintenance: boolean; members: Array<{ id: string; user: { fullName: string } }> }
interface Rule { id: string; rulePriority: number; isActive: boolean; roomId: string | null; floorId: string | null; blockId: string | null; campusId: string | null; category: { name: string } | null; issueType: { name: string } | null; team: { name: string } }
interface Sla { id: string; priority: string; acknowledgementMinutes: number; resolutionMinutes: number; workingHoursOnly: boolean }

export default function RoutingPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [teamForm, setTeamForm] = useState({ code: "", name: "", isDefaultMaintenance: false });
  const [ruleForm, setRuleForm] = useState({ teamId: "", categoryId: "", rulePriority: 100 });
  const canManageSla = user?.permissions.includes("sla.manage") ?? false;
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/responsible-teams") });
  const rules = useQuery({ queryKey: ["routing-rules"], queryFn: () => api.get<Rule[]>("/assignment-rules") });
  const categories = useQuery({ queryKey: ["issue-categories"], queryFn: () => api.get<SelectOption[]>("/issue-categories") });
  const slas = useQuery({ queryKey: ["slas"], queryFn: () => api.get<Sla[]>("/settings/sla"), enabled: canManageSla });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["teams"] }); void client.invalidateQueries({ queryKey: ["routing-rules"] }); };
  const createTeam = useMutation({ mutationFn: () => api.post("/responsible-teams", teamForm), onSuccess: () => { setTeamForm({ code: "", name: "", isDefaultMaintenance: false }); refresh(); }, onError: fail });
  const createRule = useMutation({ mutationFn: () => api.post("/assignment-rules", ruleForm), onSuccess: () => { setRuleForm({ teamId: "", categoryId: "", rulePriority: 100 }); refresh(); }, onError: fail });

  function fail(caught: Error) {
    setError(caught instanceof ApiError ? caught.message : "Configuration could not be saved.");
  }

  if (teams.isLoading || rules.isLoading) return <LoadingState />;
  if (teams.isError || rules.isError) return <ErrorState message="You do not have access to routing configuration." />;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Campus services</span><h1 className="page-title" style={{ marginTop: 6 }}>Service routing</h1><p className="page-subtitle">Deterministic teams, rules and SLA targets.</p></div></div>
    {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
    <div className="routing-grid">
      <div style={{ display: "grid", gap: 18 }}>
        <section className="card">
          <div className="section-head"><div><h2>Responsible teams</h2><p>Active groups receiving issue assignments</p></div><Users size={19} className="muted" /></div>
          <div className="team-list">{teams.data?.map((team) => <article key={team.id}><span className="list-icon"><Users size={18} /></span><div><strong>{team.name}</strong><small>{team.code} · {team.members.length} members{team.isDefaultMaintenance ? " · Default fallback" : ""}</small></div></article>)}</div>
        </section>
        <section className="card">
          <div className="section-head"><div><h2>Assignment rules</h2><p>Higher specificity wins, then configured priority</p></div><GitBranch size={19} className="muted" /></div>
          <div className="table-wrap"><table><thead><tr><th>Match</th><th>Team</th><th>Rule priority</th></tr></thead><tbody>{rules.data?.map((rule) => <tr key={rule.id}><td>{rule.issueType?.name ?? rule.category?.name ?? "College-wide default"}<small className="muted" style={{ display: "block" }}>{rule.roomId ? "Exact room" : rule.floorId ? "Floor" : rule.blockId ? "Block" : rule.campusId ? "Campus" : "College"}</small></td><td>{rule.team.name}</td><td>{rule.rulePriority}</td></tr>)}</tbody></table></div>
        </section>
        {canManageSla && <section className="card">
          <div className="section-head"><div><h2>SLA policies</h2><p>Configured acknowledgement and resolution targets</p></div><Zap size={19} className="muted" /></div>
          {slas.isLoading ? <LoadingState rows={2} /> : slas.isError ? <ErrorState message="SLA policies could not be loaded." /> : <div className="table-wrap"><table><thead><tr><th>Priority</th><th>Acknowledge</th><th>Resolve</th><th>Calendar</th></tr></thead><tbody>{slas.data?.map((sla) => <tr key={sla.id}><td>{sla.priority}</td><td>{sla.acknowledgementMinutes} min</td><td>{sla.resolutionMinutes} min</td><td>{sla.workingHoursOnly ? "Working hours" : "Elapsed time"}</td></tr>)}</tbody></table></div>}
        </section>}
      </div>
      <aside style={{ display: "grid", gap: 18, alignContent: "start" }}>
        <form className="card mini-form" onSubmit={(event: FormEvent) => { event.preventDefault(); createTeam.mutate(); }}>
          <div className="section-head"><div><h2>New team</h2><p>Create a routing target</p></div></div>
          <div><label className="field">Code<input className="input" required value={teamForm.code} onChange={(event) => setTeamForm({ ...teamForm, code: event.target.value.toUpperCase() })} /></label><label className="field">Name<input className="input" required value={teamForm.name} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} /></label><label className="check-field"><input type="checkbox" checked={teamForm.isDefaultMaintenance} onChange={(event) => setTeamForm({ ...teamForm, isDefaultMaintenance: event.target.checked })} />Default manual-assignment team</label><button className="btn btn-primary"><Plus size={17} />Create team</button></div>
        </form>
        <form className="card mini-form" onSubmit={(event: FormEvent) => { event.preventDefault(); createRule.mutate(); }}>
          <div className="section-head"><div><h2>New category rule</h2><p>College-wide category match</p></div></div>
          <div><label className="field">Category<select className="input" required value={ruleForm.categoryId} onChange={(event) => setRuleForm({ ...ruleForm, categoryId: event.target.value })}><option value="">Select category</option>{categories.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Responsible team<select className="input" required value={ruleForm.teamId} onChange={(event) => setRuleForm({ ...ruleForm, teamId: event.target.value })}><option value="">Select team</option>{teams.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Rule priority<input className="input" type="number" min={0} max={10000} value={ruleForm.rulePriority} onChange={(event) => setRuleForm({ ...ruleForm, rulePriority: Number(event.target.value) })} /></label><button className="btn btn-primary"><Plus size={17} />Create rule</button></div>
        </form>
      </aside>
    </div>
  </>;
}
