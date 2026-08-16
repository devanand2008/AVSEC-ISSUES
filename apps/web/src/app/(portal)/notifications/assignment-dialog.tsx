"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Send, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { NotificationItem } from "./notification-center";
import styles from "./notifications.module.css";

export interface AssignmentTeam {
  id: string;
  code: string;
  name: string;
  members: Array<{
    id: string;
    publicId: string;
    fullName: string;
    isPrimary: boolean;
    maxOpenIssues: number | null;
    openIssues: number;
  }>;
}

export interface AssignmentValue {
  teamId?: string;
  userId?: string;
  reason: string;
}

interface AssignmentDialogProps {
  item: NotificationItem | null;
  actionLabel: string;
  teams: AssignmentTeam[];
  loadingOptions: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (value: AssignmentValue) => void;
}

export function AssignmentDialog({
  item,
  actionLabel,
  teams,
  loadingOptions,
  saving,
  error,
  onClose,
  onSubmit,
}: AssignmentDialogProps) {
  const [teamId, setTeamId] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const selectedTeam = useMemo(() => teams.find((team) => team.id === teamId), [teamId, teams]);

  function close() {
    if (saving) return;
    setTeamId("");
    setUserId("");
    setReason("");
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!teamId && !userId) || !reason.trim()) return;
    onSubmit({ teamId: teamId || undefined, userId: userId || undefined, reason: reason.trim() });
  }

  return (
    <Dialog.Root open={Boolean(item)} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialog}>
          <div className={styles.dialogHeader}>
            <div>
              <Dialog.Title>{actionLabel} issue</Dialog.Title>
              <Dialog.Description>
                {item?.notification.context?.issueNumber ?? "Selected issue"} · Choose an active team or responsible person.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className={styles.iconButton} disabled={saving} type="button" aria-label="Close assignment dialog"><X size={18} /></button>
            </Dialog.Close>
          </div>
          <form aria-label={`${actionLabel} issue form`} className={styles.assignmentForm} onSubmit={submit}>
            {error && <div className={styles.inlineError} role="alert">{error}</div>}
            <label>
              Responsible team
              <select
                disabled={loadingOptions || saving}
                value={teamId}
                onChange={(event) => {
                  setTeamId(event.target.value);
                  setUserId("");
                }}
              >
                <option value="">Select a team</option>
                {teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              Responsible person
              <select disabled={!selectedTeam || saving} value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="">Use the team queue</option>
                {selectedTeam?.members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.fullName}{member.isPrimary ? " (primary)" : ""} · {member.openIssues} open
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assignment reason
              <textarea
                disabled={saving}
                minLength={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this assignment needed?"
                required
                rows={3}
                value={reason}
              />
            </label>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} disabled={saving} onClick={close} type="button">Cancel</button>
              <button
                className={styles.primaryButton}
                disabled={saving || loadingOptions || (!teamId && !userId) || reason.trim().length < 3}
                type="submit"
              >
                <Send size={16} aria-hidden="true" />{saving ? "Saving…" : actionLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
