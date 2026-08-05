"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs and local blob previews must bypass the public image optimizer */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, BellOff, Camera, Check, CheckCheck, Copy, Download, File,
  FileText, Flag, Forward, ImageIcon, LoaderCircle, MessageCircle,
  MoreVertical, Music, Paperclip, Pencil, Pin, Plus, Reply, Search,
  Send, SmilePlus, Star, Trash2, Users, Video, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, ApiError, idempotencyKey } from "@/lib/api";
import { resolveRuntimeUrl } from "@/lib/runtime-url";
import { useAuth } from "@/providers/auth-provider";

/* ─── types ─── */
interface Participant { userId: string; role: string; mutedUntil: string | null; pinnedAt: string | null; archivedAt: string | null; leftAt?: string | null; user: { publicId: string; fullName: string; lastLoginAt?: string | null } }
interface Conversation { id: string; type: string; title: string | null; description?: string | null; isOfficial: boolean; unreadCount: number; participants: Participant[]; messages: Array<{ id: string; body: string; type: string; createdAt: string; senderId: string; deletedAt: string | null }> }
interface Attachment { id: string; originalName: string; safeName: string; mimeType: string; sizeBytes: string; sha256: string | null; width: number | null; height: number | null }
interface Message { id: string; body: string; type: string; status: string; createdAt: string; deletedAt: string | null; editedAt: string | null; pinnedAt: string | null; sender: { publicId: string; fullName: string }; replyTo: { id: string; body: string; sender: { fullName: string } } | null; forwardedFrom: { id: string; sender: { fullName: string } } | null; readReceipts: Array<{ userId: string; readAt: string }>; reactions: Array<{ userId: string; emoji: string }>; stars: Array<{ createdAt: string }>; attachments: Attachment[] }
interface Contact { publicId: string; fullName: string; collegeIdentityId: string; roles: Array<{ role: { name: string } }> }

/* ─── config ─── */
const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,video/mp4,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm";

/* ─── emoji picker ─── */
const EMOJI_PRESETS = ["👍","❤️","😂","😮","😢","🙏","🔥","✅","👏","😍"];

/* ─── helpers ─── */
function reactionCounts(reactions: Message["reactions"]) {
  return reactions.reduce<Record<string, number>>((counts, r) => ({ ...counts, [r.emoji]: (counts[r.emoji] ?? 0) + 1 }), {});
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}
function compactTime(value: string) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}
function initials(name: string) {
  return name.split(" ").map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
}
function conversationTitle(item: Conversation, myId?: string) {
  if (item.title) return item.title;
  return item.participants.find((p) => p.user.publicId !== myId)?.user.fullName ?? "Conversation";
}
function groupTypeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── avatar ─── */
function Avatar({ name, size = 40, online = false, className = "" }: { name: string; size?: number; online?: boolean; className?: string }) {
  const colors = ["#1D4ED8","#0891B2","#7C3AED","#0369A1","#0B3D91","#065F46","#92400E","#BE185D"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <span
      className={`avs-avatar ${className}`}
      style={{ width: size, height: size, minWidth: size, fontSize: size * 0.38, background: color }}
      aria-hidden="true"
    >
      {initials(name)}
      {online && <span className="avs-avatar-dot" />}
    </span>
  );
}

/* ─── context menu ─── */
interface ContextMenuProps {
  x: number; y: number;
  onClose: () => void;
  items: Array<{ icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }>;
}
function ContextMenu({ x, y, onClose, items }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="avs-context-menu"
      style={{ top: Math.min(y, window.innerHeight - 280), left: Math.min(x, window.innerWidth - 200) }}
      role="menu"
    >
      {items.map((item, index) => (
        <button
          key={index}
          className={`avs-context-item ${item.danger ? "avs-context-item--danger" : ""}`}
          role="menuitem"
          onClick={() => { item.onClick(); onClose(); }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ─── emoji picker ─── */
function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return (
    <div ref={ref} className="avs-emoji-picker" role="dialog" aria-label="Emoji picker">
      {EMOJI_PRESETS.map((emoji) => (
        <button key={emoji} onClick={() => { onPick(emoji); onClose(); }} aria-label={emoji}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

/* ─── attachment item ─── */
function AttachmentItem({ messageId, attachment, onOpen }: { messageId: string; attachment: Attachment; onOpen: () => void }) {
  const preview = useQuery({
    queryKey: ["attachment-preview", attachment.id],
    queryFn: () => api.get<{ url: string }>(`/messages/${messageId}/attachments/${attachment.id}/download`),
    enabled: attachment.mimeType.startsWith("image/"),
    staleTime: 240_000,
  });
  const url = preview.data ? resolveRuntimeUrl(preview.data.url) : "";

  if (attachment.mimeType.startsWith("image/")) {
    return (
      <button className="avs-media-thumb" onClick={onOpen} title={attachment.originalName}>
        {url ? (
          <img src={url} alt={attachment.originalName} loading="lazy" />
        ) : (
          <span className="avs-media-thumb-placeholder">
            <ImageIcon size={28} />
          </span>
        )}
      </button>
    );
  }
  if (attachment.mimeType.startsWith("video/")) {
    return (
      <button className="avs-file-chip avs-file-chip--video" onClick={onOpen}>
        <Video size={20} />
        <span>
          <strong>{attachment.originalName}</strong>
          <small>{formatBytes(Number(attachment.sizeBytes))}</small>
        </span>
        <Download size={16} />
      </button>
    );
  }
  if (attachment.mimeType.startsWith("audio/")) {
    return (
      <button className="avs-file-chip avs-file-chip--audio" onClick={onOpen}>
        <Music size={20} />
        <span>
          <strong>{attachment.originalName}</strong>
          <small>{formatBytes(Number(attachment.sizeBytes))}</small>
        </span>
        <Download size={16} />
      </button>
    );
  }
  const Icon = attachment.mimeType === "application/pdf" ? FileText : File;
  return (
    <button className="avs-file-chip" onClick={onOpen}>
      <Icon size={20} />
      <span>
        <strong>{attachment.originalName}</strong>
        <small>{attachment.mimeType.split("/").at(-1)?.toUpperCase()} · {formatBytes(Number(attachment.sizeBytes))}</small>
      </span>
      <Download size={16} />
    </button>
  );
}

/* ─── pending file preview ─── */
function FilePreview({ file }: { file: File }) {
  const [url] = useState(() => file.type.startsWith("image/") ? URL.createObjectURL(file) : "");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (url) return <img src={url} alt="" className="avs-pending-img" />;
  if (file.type.startsWith("video/")) return <Video size={22} />;
  if (file.type.startsWith("audio/")) return <Music size={22} />;
  return <File size={22} />;
}

/* ─── main component ─── */
function MessagesPageInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const client = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const queuedMessagesRef = useRef<Map<string, { conversationId: string; body: string; replyToId?: string; attachments: File[]; clientId: string }>>(new Map());
  const retryQueuedRef = useRef<() => void>(() => undefined);
  const [selected, setSelected] = useState(() => searchParams?.get("id") ?? "");
  const [body, setBody] = useState("");
  const [conversationSearch, setConversationSearch] = useState(() => searchParams?.get("search") ?? "");
  const [contactSearch, setContactSearch] = useState("");
  const [showContacts, setShowContacts] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [showEmoji, setShowEmoji] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting" | "offline" | "connection_failed">("connecting");
  const [queuedConversationIds, setQueuedConversationIds] = useState<Set<string>>(new Set());
  const canCreateDirect = user?.permissions.includes("conversations.create_direct") ?? false;

  /* ─── queries ─── */
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<Conversation[]>("/conversations"),
    refetchInterval: 20_000,
  });
  const activeId = selected || conversations.data?.[0]?.id || "";
  const active = conversations.data?.find((item) => item.id === activeId);
  const ownPreference = active?.participants.find((p) => p.user.publicId === user?.id);
  const contacts = useQuery({
    queryKey: ["conversation-contacts", contactSearch],
    queryFn: () => api.get<Contact[]>(`/conversations/contacts?search=${encodeURIComponent(contactSearch)}`),
    enabled: canCreateDirect && showContacts && contactSearch.trim().length >= 2,
  });
  const messages = useInfiniteQuery({
    queryKey: ["messages", activeId],
    queryFn: ({ pageParam }) => api.get<Message[]>(`/conversations/${activeId}/messages${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.length === 50 ? lastPage.at(-1)?.id : undefined,
    enabled: Boolean(activeId),
  });
  const orderedMessages = useMemo(() => (messages.data?.pages.flat() ?? []).slice().reverse(), [messages.data]);
  const latestMessageId = orderedMessages.at(-1)?.id;

  const refreshMessages = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["messages", activeId] });
    void client.invalidateQueries({ queryKey: ["conversations"] });
  }, [activeId, client]);

  useEffect(() => {
    if (!selected && conversationSearch && conversations.data) {
      const match = conversations.data.find((c) =>
        conversationTitle(c, user?.id).toLowerCase().includes(conversationSearch.toLowerCase())
      );
      if (match) {
        const timeout = window.setTimeout(() => setSelected(match.id), 0);
        return () => window.clearTimeout(timeout);
      }
    }
    return undefined;
  }, [conversations.data, conversationSearch, selected, user?.id]);

  /* ─── socket ─── */
  useEffect(() => {
    if (!activeId) return;
    const connectingTimer = window.setTimeout(() => setConnectionState("connecting"), 0);
    const socket = io(resolveRuntimeUrl(process.env.NEXT_PUBLIC_SOCKET_URL ?? "/realtime"), {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 750,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnectionState("connected");
      socket.emit("conversation.join", { conversationId: activeId });
      refreshMessages();
      retryQueuedRef.current();
    });
    socket.on("disconnect", (reason) => setConnectionState(reason === "io client disconnect" ? "offline" : "reconnecting"));
    socket.on("connect_error", () => setConnectionState("reconnecting"));
    socket.io.on("reconnect_failed", () => setConnectionState("connection_failed"));
    socket.on("message.created", () => refreshMessages());
    socket.on("message.updated", () => refreshMessages());
    socket.on("message.read", () => refreshMessages());
    socket.on("typing.changed", (event: { userId: string; typing: boolean }) =>
      setTypingUsers((current) => { const next = new Set(current); if (event.typing) next.add(event.userId); else next.delete(event.userId); return next; })
    );
    socket.on("presence.changed", (event: { userId: string; isOnline: boolean }) =>
      setOnlineUsers((current) => { const next = new Set(current); if (event.isOnline) next.add(event.userId); else next.delete(event.userId); return next; })
    );
    return () => { window.clearTimeout(connectingTimer); socket.disconnect(); socketRef.current = null; };
  }, [activeId, refreshMessages]);

  /* ─── mark read ─── */
  useEffect(() => {
    if (!activeId || !latestMessageId) return;
    void api.post(`/conversations/${activeId}/read`)
      .then(() => client.invalidateQueries({ queryKey: ["conversations"] }))
      .catch(() => undefined);
  }, [activeId, latestMessageId, client]);

  /* ─── draft + typing ─── */
  useEffect(() => {
    if (!activeId) return;
    const timeout = window.setTimeout(
      () => setBody(draftsRef.current.get(activeId) ?? ""),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    if (body) draftsRef.current.set(activeId, body);
    else draftsRef.current.delete(activeId);
    socketRef.current?.emit("typing.changed", { conversationId: activeId, typing: Boolean(body.trim()) });
    const timeout = window.setTimeout(() => socketRef.current?.emit("typing.changed", { conversationId: activeId, typing: false }), 1400);
    return () => window.clearTimeout(timeout);
  }, [activeId, body]);

  /* ─── scroll to bottom on new messages ─── */
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [orderedMessages.length]);

  function handleError(caught: unknown) {
    setError(caught instanceof ApiError ? caught.message : "The message action could not be completed.");
  }

  /* ─── mutations ─── */
  const send = useMutation({
    mutationFn: async (outgoing: { conversationId: string; body: string; replyToId?: string; attachments: File[]; clientId: string }) => {
      const firstType = outgoing.attachments[0]?.type ?? "";
      const messageType = firstType.startsWith("image/") ? "IMAGE" : firstType.startsWith("video/") ? "VIDEO" : firstType.startsWith("audio/") ? "AUDIO" : outgoing.attachments.length ? "DOCUMENT" : "TEXT";
      const attachmentUploadIds: string[] = [];
      for (const [index, file] of outgoing.attachments.entries()) {
        setUploadStatus(`Uploading ${index + 1} of ${outgoing.attachments.length}…`);
        const signed = await api.post<{ uploadId: string; storageKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>(
          "/messages/attachments",
          { conversationId: outgoing.conversationId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, purpose: "MESSAGE" },
        );
        await api.upload(resolveRuntimeUrl(signed.uploadUrl), file, signed.requiredHeaders);
        await api.post(`/messages/attachments/${signed.uploadId}/complete`, {
          conversationId: outgoing.conversationId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, purpose: "MESSAGE", storageKey: signed.storageKey,
        });
        attachmentUploadIds.push(signed.uploadId);
      }
      return api.post<{ id: string }>(`/conversations/${outgoing.conversationId}/messages`, {
        body: outgoing.body,
        ...(outgoing.replyToId ? { replyToId: outgoing.replyToId } : {}),
        messageType,
        ...(attachmentUploadIds.length ? { attachmentUploadIds } : {}),
        clientId: outgoing.clientId,
      });
    },
    onSuccess: (_result, outgoing) => {
      queuedMessagesRef.current.delete(outgoing.conversationId);
      setQueuedConversationIds(new Set(queuedMessagesRef.current.keys()));
      draftsRef.current.delete(outgoing.conversationId);
      setUploadStatus(""); setError(""); refreshMessages();
      window.setTimeout(() => retryQueuedRef.current(), 0);
    },
    onError: (_caught, outgoing) => {
      queuedMessagesRef.current.set(outgoing.conversationId, outgoing);
      setQueuedConversationIds(new Set(queuedMessagesRef.current.keys()));
      setUploadStatus("");
      setError("Message is pending and will retry when AVS Messenger reconnects.");
    },
  });

  useEffect(() => {
    retryQueuedRef.current = () => {
      if (!socketRef.current?.connected || send.isPending) return;
      const next = queuedMessagesRef.current.values().next().value;
      if (next) send.mutate(next);
    };
  }, [send]);

  const createDirect = useMutation({
    mutationFn: (participantPublicId: string) => api.post<Conversation>("/conversations/direct", { participantPublicId }),
    onSuccess: (conversation) => {
      setShowContacts(false); setContactSearch(""); setSelected(conversation.id);
      setBody(draftsRef.current.get(conversation.id) ?? "");
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: handleError,
  });
  const react = useMutation({ mutationFn: ({ id, emoji }: { id: string; emoji: string }) => api.post(`/messages/${id}/reactions`, { emoji }), onSuccess: refreshMessages, onError: handleError });
  const remove = useMutation({ mutationFn: ({ id, scope }: { id: string; scope: "self" | "everyone" }) => api.delete(`/messages/${id}?scope=${scope}`), onSuccess: refreshMessages, onError: handleError });
  const editMutation = useMutation({ mutationFn: ({ id, text }: { id: string; text: string }) => api.patch(`/messages/${id}`, { body: text }), onSuccess: () => { setEditingMessage(null); refreshMessages(); }, onError: handleError });
  const star = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => active ? api.delete(`/messages/${id}/star`) : api.post(`/messages/${id}/star`), onSuccess: refreshMessages, onError: handleError });
  const reportMsg = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/messages/${id}/report`, { reason }), onSuccess: () => setError("Message reported for authorized review."), onError: handleError });
  const preference = useMutation({ mutationFn: (input: { pinned?: boolean; mutedUntil?: string; archived?: boolean; markedUnread?: boolean }) => api.patch(`/conversations/${activeId}/preferences`, input), onSuccess: () => client.invalidateQueries({ queryKey: ["conversations"] }), onError: handleError });
  const syncGroups = useMutation({ mutationFn: () => api.post("/conversations/sync-official"), onSuccess: () => client.invalidateQueries({ queryKey: ["conversations"] }), onError: handleError });
  const forwardMutation = useMutation({
    mutationFn: async (targetConversationId: string) => {
      if (!forwardingMessage) return;
      await api.post(`/conversations/${targetConversationId}/messages`, {
        body: forwardingMessage.body || "(forwarded message)",
        forwardedFromId: forwardingMessage.id,
        messageType: forwardingMessage.type,
        clientId: idempotencyKey(),
      });
    },
    onSuccess: () => {
      setForwardingMessage(null);
      refreshMessages();
    },
    onError: handleError,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    queueOrSend();
  }
  function queueOrSend() {
    if ((!body.trim() && !attachments.length) || send.isPending || !activeId || queuedMessagesRef.current.has(activeId)) return;
    const outgoing = {
      conversationId: activeId,
      body: body.trim(),
      ...(replyTo ? { replyToId: replyTo.id } : {}),
      attachments: [...attachments],
      clientId: idempotencyKey(),
    };
    if (connectionState === "connected") {
      draftsRef.current.delete(activeId);
      setBody(""); setReplyTo(null); setAttachments([]);
      send.mutate(outgoing);
      return;
    }
    queuedMessagesRef.current.set(activeId, outgoing);
    setQueuedConversationIds(new Set(queuedMessagesRef.current.keys()));
    draftsRef.current.delete(activeId);
    setBody(""); setReplyTo(null); setAttachments([]);
    setError("Message queued locally. It will send after AVS Messenger reconnects.");
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setAttachments((current) => [...current, ...files].slice(0, 10));
    event.target.value = "";
  }
  async function downloadAttachment(messageId: string, attachment: Attachment) {
    try {
      const result = await api.get<{ url: string }>(`/messages/${messageId}/attachments/${attachment.id}/download`);
      const url = resolveRuntimeUrl(result.url);
      if (attachment.mimeType.startsWith("image/")) setViewer({ url, name: attachment.originalName });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) { handleError(caught); }
  }
  function openContextMenu(e: React.MouseEvent, message: Message) {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, message });
  }

  const filtered = conversations.data?.filter((item) =>
    conversationTitle(item, user?.id).toLowerCase().includes(conversationSearch.toLowerCase())
  ) ?? [];
  const typingNames = active?.participants.filter((p) => typingUsers.has(p.userId)).map((p) => p.user.fullName) ?? [];
  const directPeer = active?.type === "DIRECT" ? active.participants.find((p) => p.user.publicId !== user?.id) : undefined;
  const peerOnline = directPeer ? onlineUsers.has(directPeer.userId) : false;

  if (conversations.isLoading) return <div className="avs-messenger-shell"><LoadingState /></div>;
  if (conversations.isError) return <div className="avs-messenger-shell"><ErrorState /></div>;

  return (
    <>
      {/* ── page wrapper ── */}
      <div className="avs-messenger-shell">

        {/* ── LEFT SIDEBAR ── */}
        <aside className={`avs-sidebar ${selected ? "sidebar-hidden-mobile" : ""}`}>
          {/* Sidebar header */}
          <div className="avs-sidebar-header">
            <div>
              <h1 className="avs-sidebar-title">AVS Connect</h1>
              <p className="avs-sidebar-subtitle">College Messenger</p>
            </div>
            <div className="avs-sidebar-actions">
              {user?.permissions.includes("conversations.manage_official") && (
                <button
                  id="sync-groups-btn"
                  className="avs-icon-btn"
                  title="Sync official groups"
                  disabled={syncGroups.isPending}
                  onClick={() => syncGroups.mutate()}
                >
                  <Users size={19} />
                </button>
              )}
              {canCreateDirect && (
                <button
                  id="new-chat-btn"
                  className="avs-icon-btn avs-icon-btn--primary"
                  title="New conversation"
                  onClick={() => setShowContacts(true)}
                >
                  <Plus size={19} />
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="avs-sidebar-search">
            <label className="avs-search-label">
              <Search size={16} />
              <input
                id="conversation-search"
                aria-label="Search conversations"
                placeholder="Search conversations…"
                value={conversationSearch}
                onChange={(e) => setConversationSearch(e.target.value)}
              />
            </label>
          </div>

          {/* Conversation list */}
          <div className="avs-conversation-list" role="listbox" aria-label="Conversations">
            {!filtered.length && (
              <div className="avs-conv-empty">
                <MessageCircle size={40} />
                <p>No conversations yet</p>
                <small>Synchronize official groups or start a new chat.</small>
              </div>
            )}
            {filtered.map((item) => {
              const label = conversationTitle(item, user?.id);
              const own = item.participants.find((p) => p.user.publicId === user?.id);
              const lastMsg = item.messages[0];
              const isActive = activeId === item.id;
              const peerDirectUser = item.type === "DIRECT" ? item.participants.find((p) => p.user.publicId !== user?.id) : undefined;
              const peerIsOnline = peerDirectUser ? onlineUsers.has(peerDirectUser.userId) : false;
              return (
                <button
                  key={item.id}
                  id={`conv-${item.id}`}
                  className={`avs-conv-item ${isActive ? "avs-conv-item--active" : ""}`}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    setSelected(item.id);
                    setBody(draftsRef.current.get(item.id) ?? "");
                  }}
                >
                  <Avatar name={label} size={46} online={peerIsOnline} />
                  <div className="avs-conv-info">
                    <div className="avs-conv-top">
                      <span className="avs-conv-name">{label}</span>
                      <time className="avs-conv-time">
                        {lastMsg ? compactTime(lastMsg.createdAt) : ""}
                      </time>
                    </div>
                    <div className="avs-conv-bottom">
                      <span className="avs-conv-preview">
                        {lastMsg?.deletedAt ? "Message removed" : lastMsg?.body || groupTypeLabel(item.type)}
                      </span>
                      <span className="avs-conv-flags">
                        {own?.mutedUntil && <BellOff size={12} />}
                        {own?.pinnedAt && <Pin size={12} />}
                        {item.unreadCount > 0 && (
                          <span className="avs-unread-badge" aria-label={`${item.unreadCount} unread`}>
                            {item.unreadCount > 99 ? "99+" : item.unreadCount}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── RIGHT CHAT PANE ── */}
        <section className={`avs-chat-pane ${selected ? "chat-pane-active" : ""}`}>
          {!activeId || !active ? (
            <div className="avs-chat-empty-state">
              <div className="avs-chat-empty-inner">
                <MessageCircle size={64} />
                <h2>Select a conversation</h2>
                <p>Choose a conversation from the left to start messaging.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <header className="avs-chat-header">
                <button
                  id="back-to-convlist"
                  className="avs-icon-btn avs-back-btn"
                  aria-label="Back to conversations"
                  onClick={() => setSelected("")}
                >
                  <ArrowLeft size={21} />
                </button>
                <Avatar name={conversationTitle(active, user?.id)} size={40} online={peerOnline} />
                <div className="avs-chat-identity" onClick={() => setShowGroupInfo(true)}>
                  <strong className="avs-chat-name">{conversationTitle(active, user?.id)}</strong>
                  <small className="avs-chat-sub">
                    {typingNames.length
                      ? `${typingNames.slice(0, 2).join(", ")} typing…`
                      : peerOnline
                      ? "Online"
                      : active.type === "DIRECT"
                      ? directPeer?.user.lastLoginAt
                        ? `Last seen ${compactTime(directPeer.user.lastLoginAt)}`
                        : "Offline"
                      : `${active.participants.length} participants`}
                  </small>
                </div>
                <div className="avs-chat-header-actions">
                  <button id="pin-conv-btn" className="avs-icon-btn" title={ownPreference?.pinnedAt ? "Unpin" : "Pin"} onClick={() => preference.mutate({ pinned: !ownPreference?.pinnedAt })}>
                    <Pin size={18} />
                  </button>
                  <button id="mute-conv-btn" className="avs-icon-btn" title={ownPreference?.mutedUntil ? "Unmute" : "Mute for 8 hours"} onClick={() => preference.mutate({ mutedUntil: ownPreference?.mutedUntil ? new Date(0).toISOString() : new Date(Date.now() + 8 * 3_600_000).toISOString() })}>
                    <BellOff size={18} />
                  </button>
                  <button id="group-info-btn" className="avs-icon-btn" title="Group info" onClick={() => setShowGroupInfo(true)}>
                    <MoreVertical size={18} />
                  </button>
                </div>
              </header>

              {connectionState !== "connected" && (
                <div className="avs-error-bar avs-error-bar--notice" role="status">
                  <span>{connectionState === "connecting" ? "Connecting to AVS Messenger…" : connectionState === "reconnecting" ? "Connection lost. Reconnecting… Your draft is preserved." : connectionState === "connection_failed" ? "Unable to connect to AVS Messenger. Your draft and pending message are preserved." : "Messenger is offline. Your draft is preserved until reconnection."}</span>
                  <button type="button" onClick={() => { setConnectionState("connecting"); if (socketRef.current?.connected) retryQueuedRef.current(); else socketRef.current?.connect(); }}>Retry</button>
                </div>
              )}
              {queuedConversationIds.size > 0 && (
                <div className="avs-error-bar avs-error-bar--notice" role="status">
                  <span>{queuedConversationIds.size} pending message{queuedConversationIds.size === 1 ? "" : "s"}. Pending messages are not shown as sent and retry after reconnection.</span>
                  {connectionState === "connected" && <button type="button" disabled={send.isPending} onClick={() => retryQueuedRef.current()}>Retry now</button>}
                </div>
              )}

              {/* Error bar */}
              {error && (
                <div className={`avs-error-bar ${error.startsWith("Message reported") ? "avs-error-bar--notice" : ""}`}>
                  <span>{error}</span>
                  <button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button>
                </div>
              )}

              {/* Message stream */}
              <div className="avs-message-stream" ref={streamRef} id="message-stream">
                {messages.hasNextPage && (
                  <button
                    id="load-older-btn"
                    className="avs-load-older"
                    disabled={messages.isFetchingNextPage}
                    onClick={() => messages.fetchNextPage()}
                  >
                    {messages.isFetchingNextPage ? <LoaderCircle className="spin" size={16} /> : null}
                    {messages.isFetchingNextPage ? "Loading…" : "Load older messages"}
                  </button>
                )}
                {messages.isLoading && <LoadingState rows={4} />}

                {orderedMessages.map((message, index) => {
                  const mine = message.sender.publicId === user?.id;
                  const prev = orderedMessages[index - 1];
                  const showDate = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                  const reactions = reactionCounts(message.reactions);
                  const allRead = message.readReceipts.length >= (active.participants.filter((p) => p.user.publicId !== user?.id).length);

                  return (
                    <div key={message.id} className="avs-message-group">
                      {/* Date separator */}
                      {showDate && (
                        <div className="avs-date-separator" role="separator" aria-label={dateLabel(message.createdAt)}>
                          <span>{dateLabel(message.createdAt)}</span>
                        </div>
                      )}

                      {/* Message row */}
                      <div className={`avs-message-row ${mine ? "avs-message-row--mine" : ""}`} id={`message-${message.id}`}>
                        {!mine && <Avatar name={message.sender.fullName} size={32} className="avs-message-avatar" />}

                        <div className="avs-bubble-wrap">
                          {/* Sender name (group) */}
                          {!mine && active.type !== "DIRECT" && (
                            <span className="avs-message-sender">{message.sender.fullName}</span>
                          )}

                          {/* Forwarded from */}
                          {message.forwardedFrom && !message.deletedAt && (
                            <div className="avs-forwarded-label"><Forward size={12} />Forwarded</div>
                          )}

                          {/* Reply preview */}
                          {message.replyTo && !message.deletedAt && (
                            <button
                              className="avs-reply-preview"
                              onClick={() => document.getElementById(`message-${message.replyTo?.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                            >
                              <div className="avs-reply-accent" />
                              <div>
                                <strong>{message.replyTo.sender.fullName}</strong>
                                <span>{message.replyTo.body.slice(0, 100)}</span>
                              </div>
                            </button>
                          )}

                          {/* Bubble */}
                          <div
                            className={`avs-bubble ${mine ? "avs-bubble--sent" : "avs-bubble--recv"}`}
                            onContextMenu={(e) => !message.deletedAt && openContextMenu(e, message)}
                          >
                            {message.deletedAt ? (
                              <em className="avs-deleted">This message was removed</em>
                            ) : (
                              <>
                                {message.body && <p className="avs-bubble-text">{message.body}</p>}
                                {message.attachments.length > 0 && (
                                  <div className={`avs-attachments ${message.attachments.filter((a) => a.mimeType.startsWith("image/")).length > 1 ? "avs-media-grid" : ""}`}>
                                    {message.attachments.map((file) => (
                                      <AttachmentItem
                                        key={file.id}
                                        messageId={message.id}
                                        attachment={file}
                                        onOpen={() => void downloadAttachment(message.id, file)}
                                      />
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Meta row */}
                          <div className={`avs-meta ${mine ? "avs-meta--mine" : ""}`}>
                            <time className="avs-meta-time">
                              {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {message.editedAt && <span className="avs-edited"> · edited</span>}
                            </time>
                            {mine && (
                              <span className="avs-ticks" title={allRead ? "Read" : "Delivered"}>
                                {allRead
                                  ? <CheckCheck size={14} className="avs-ticks--read" />
                                  : <Check size={14} />}
                              </span>
                            )}
                          </div>

                          {/* Reactions */}
                          {Object.keys(reactions).length > 0 && (
                            <div className="avs-reactions">
                              {Object.entries(reactions).map(([emoji, count]) => (
                                <button key={emoji} className="avs-reaction-chip" onClick={() => react.mutate({ id: message.id, emoji })}>
                                  {emoji} <span>{count}</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Quick action buttons */}
                          {!message.deletedAt && (
                            <div className={`avs-quick-actions ${mine ? "avs-quick-actions--mine" : ""}`}>
                              <button id={`react-${message.id}`} className="avs-qa-btn" title="React" onClick={() => setShowEmoji(showEmoji === message.id ? null : message.id)}>
                                <SmilePlus size={13} />
                              </button>
                              <button id={`reply-${message.id}`} className="avs-qa-btn" title="Reply" onClick={() => { setReplyTo(message); document.getElementById("message-input")?.focus(); }}>
                                <Reply size={13} />
                              </button>
                              <button id={`more-${message.id}`} className="avs-qa-btn" title="More options" onClick={(e) => openContextMenu(e, message)}>
                                <MoreVertical size={13} />
                              </button>
                              {showEmoji === message.id && (
                                <EmojiPicker onPick={(emoji) => react.mutate({ id: message.id, emoji })} onClose={() => setShowEmoji(null)} />
                              )}
                            </div>
                          )}
                        </div>

                        {mine && <div className="avs-message-spacer" />}
                      </div>
                    </div>
                  );
                })}

                {/* Typing indicator */}
                {typingNames.length > 0 && (
                  <div className="avs-typing-row">
                    <div className="avs-typing-bubble">
                      <span className="avs-typing-dots"><span /><span /><span /></span>
                      <small>{typingNames.slice(0, 2).join(", ")} typing…</small>
                    </div>
                  </div>
                )}
              </div>

              {/* Reply context */}
              {replyTo && (
                <div className="avs-reply-context">
                  <Reply size={14} />
                  <div>
                    <strong>{replyTo.sender.fullName}</strong>
                    <span>{replyTo.body.slice(0, 80)}</span>
                  </div>
                  <button className="avs-icon-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Pending attachments */}
              {attachments.length > 0 && (
                <div className="avs-pending-attachments">
                  {attachments.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}`} className="avs-pending-item">
                      <FilePreview file={file} />
                      <span className="avs-pending-name">
                        {file.name}
                        <small>{formatBytes(file.size)}</small>
                      </span>
                      <button
                        className="avs-icon-btn"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Edit message bar */}
              {editingMessage && (
                <form
                  className="avs-edit-bar"
                  onSubmit={(e) => { e.preventDefault(); editMutation.mutate(editingMessage); }}
                >
                  <Pencil size={15} />
                  <input
                    autoFocus
                    value={editingMessage.text}
                    onChange={(e) => setEditingMessage({ ...editingMessage, text: e.target.value })}
                    placeholder="Edit message…"
                  />
                  <button type="submit" className="avs-icon-btn avs-icon-btn--primary" disabled={editMutation.isPending}>
                    <Check size={16} />
                  </button>
                  <button type="button" className="avs-icon-btn" onClick={() => setEditingMessage(null)}>
                    <X size={16} />
                  </button>
                </form>
              )}

              {/* Composer */}
              <form className="avs-composer" onSubmit={submit}>
                <div className="avs-composer-tools">
                  <button
                    id="attach-files-btn"
                    type="button"
                    className="avs-icon-btn"
                    aria-label="Attach files"
                    title="Attach files"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip size={20} />
                  </button>
                  <input ref={fileRef} type="file" multiple hidden accept={ACCEPTED_FILES} onChange={chooseFiles} />
                  <button
                    id="take-photo-btn"
                    type="button"
                    className="avs-icon-btn"
                    aria-label="Take photo"
                    title="Camera"
                    onClick={() => cameraRef.current?.click()}
                  >
                    <Camera size={20} />
                  </button>
                  <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" onChange={chooseFiles} />
                </div>
                <div className="avs-composer-input-wrap">
                  <textarea
                    id="message-input"
                    rows={1}
                    aria-label="Type a message"
                    placeholder="Type a message…"
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); queueOrSend(); }
                    }}
                  />
                </div>
                <button
                  id="send-message-btn"
                  type="submit"
                  className={`avs-send-btn ${(body.trim() || attachments.length) ? "avs-send-btn--active" : ""}`}
                  aria-label="Send message"
                  disabled={(!body.trim() && !attachments.length) || send.isPending || queuedConversationIds.has(activeId)}
                >
                  {send.isPending ? <LoaderCircle className="spin" size={20} /> : <Send size={20} />}
                </button>
              </form>
              {uploadStatus && <div className="avs-upload-status"><LoaderCircle className="spin" size={14} />{uploadStatus}</div>}
            </>
          )}
        </section>
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              icon: <Reply size={15} />, label: "Reply",
              onClick: () => { setReplyTo(contextMenu.message); document.getElementById("message-input")?.focus(); },
            },
            {
              icon: <Forward size={15} />, label: "Forward",
              onClick: () => setForwardingMessage(contextMenu.message),
            },
            {
              icon: <Copy size={15} />, label: "Copy text",
              onClick: () => void navigator.clipboard.writeText(contextMenu.message.body),
            },
            {
              icon: <Star size={15} />, label: contextMenu.message.stars.length ? "Unstar" : "Star",
              onClick: () => star.mutate({ id: contextMenu.message.id, active: contextMenu.message.stars.length > 0 }),
            },
            ...(contextMenu.message.sender.publicId === user?.id && user?.permissions.includes("messages.edit_own") ? [{
              icon: <Pencil size={15} />, label: "Edit",
              onClick: () => setEditingMessage({ id: contextMenu.message.id, text: contextMenu.message.body }),
            }] : []),
            ...(contextMenu.message.sender.publicId === user?.id && user?.permissions.includes("messages.delete_own") ? [{
              icon: <Trash2 size={15} />, label: "Delete for everyone", danger: true,
              onClick: () => { if (window.confirm("Delete this message for everyone?")) remove.mutate({ id: contextMenu.message.id, scope: "everyone" }); },
            }] : []),
            {
              icon: <Trash2 size={15} />, label: "Delete for me", danger: true,
              onClick: () => remove.mutate({ id: contextMenu.message.id, scope: "self" }),
            },
            ...(contextMenu.message.sender.publicId !== user?.id && user?.permissions.includes("messages.report") ? [{
              icon: <Flag size={15} />, label: "Report", danger: true,
              onClick: () => {
                const reason = window.prompt("Why are you reporting this message?");
                if (reason && reason.trim().length >= 5) reportMsg.mutate({ id: contextMenu.message.id, reason: reason.trim() });
              },
            }] : []),
          ]}
        />
      )}

      {/* ── New conversation modal ── */}
      {canCreateDirect && showContacts && (
        <div className="avs-modal-backdrop" onClick={() => setShowContacts(false)}>
          <section className="avs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New conversation">
            <header className="avs-modal-header">
              <div>
                <span className="avs-modal-eyebrow">College directory</span>
                <h2>New conversation</h2>
              </div>
              <button type="button" className="avs-icon-btn" onClick={() => setShowContacts(false)} aria-label="Close"><X /></button>
            </header>
            <div className="avs-modal-search">
              <label className="avs-search-label">
                <Search size={16} />
                <input
                  id="contact-search-input"
                  autoFocus
                  aria-label="Search permitted contacts"
                  placeholder="Search name or college ID (min. 2 characters)"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="avs-modal-list">
              {contacts.isError ? (
                <ErrorState message="The permitted contact directory could not be loaded." />
              ) : contacts.isFetching ? (
                <LoadingState rows={3} />
              ) : contacts.data?.length ? (
                contacts.data.map((contact) => (
                  <div key={contact.publicId} className="avs-contact-row">
                    <Avatar name={contact.fullName} size={40} />
                    <div className="avs-contact-info">
                      <strong>{contact.fullName}</strong>
                      <small>{contact.collegeIdentityId} · {contact.roles.map((r) => r.role.name).join(", ")}</small>
                    </div>
                    <button
                      id={`start-chat-${contact.publicId}`}
                      className="btn btn-primary"
                      disabled={createDirect.isPending}
                      onClick={() => createDirect.mutate(contact.publicId)}
                    >
                      Message
                    </button>
                  </div>
                ))
              ) : contactSearch.trim().length >= 2 ? (
                <EmptyState title="No contacts found" message="Try a different name or college ID." />
              ) : (
                <p className="avs-modal-hint">Type at least 2 characters to search.</p>
              )}
            </div>
            <footer className="avs-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowContacts(false)}>Cancel</button>
            </footer>
          </section>
        </div>
      )}

      {/* ── Group info drawer ── */}
      {showGroupInfo && active && (
        <div className="avs-modal-backdrop" onClick={() => setShowGroupInfo(false)}>
          <aside className="avs-details-drawer" onClick={(e) => e.stopPropagation()}>
            <header className="avs-modal-header">
              <div>
                <Avatar name={conversationTitle(active, user?.id)} size={48} />
                <h2 style={{ marginTop: 8 }}>{conversationTitle(active, user?.id)}</h2>
                <small className="avs-sidebar-subtitle">{groupTypeLabel(active.type)}</small>
              </div>
              <button className="avs-icon-btn" onClick={() => setShowGroupInfo(false)} aria-label="Close"><X /></button>
            </header>
            {active.description && <p style={{ margin: "0 20px 12px", color: "var(--chat-muted)", fontSize: 14 }}>{active.description}</p>}
            <div className="avs-drawer-section">
              <h3>Participants ({active.participants.length})</h3>
              {active.participants.filter((p) => !p.leftAt).map((p) => (
                <div key={p.userId} className="avs-contact-row">
                  <Avatar name={p.user.fullName} size={36} online={onlineUsers.has(p.userId)} />
                  <div className="avs-contact-info">
                    <strong>{p.user.fullName}</strong>
                    <small>{p.role}</small>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {/* ── Forward message modal ── */}
      {forwardingMessage && (
        <div className="avs-modal-backdrop" onClick={() => setForwardingMessage(null)}>
          <section className="avs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Forward message">
            <header className="avs-modal-header">
              <div>
                <span className="avs-modal-eyebrow">Select recipient</span>
                <h2>Forward message</h2>
              </div>
              <button type="button" className="avs-icon-btn" onClick={() => setForwardingMessage(null)} aria-label="Close"><X /></button>
            </header>
            <div className="avs-modal-list" style={{ maxHeight: 400 }}>
              {conversations.data?.map((conv) => (
                <div key={conv.id} className="avs-contact-row" style={{ padding: "10px 16px" }}>
                  <Avatar name={conversationTitle(conv, user?.id)} size={40} />
                  <div className="avs-contact-info">
                    <strong>{conversationTitle(conv, user?.id)}</strong>
                    <small>{groupTypeLabel(conv.type)} · {conv.participants.length} participants</small>
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={forwardMutation.isPending}
                    onClick={() => forwardMutation.mutate(conv.id)}
                  >
                    Send
                  </button>
                </div>
              ))}
            </div>
            <footer className="avs-modal-footer">
              <button className="btn btn-secondary" onClick={() => setForwardingMessage(null)}>Cancel</button>
            </footer>
          </section>
        </div>
      )}

      {/* ── Image viewer ── */}
      {viewer && (
        <div className="avs-image-viewer" role="dialog" aria-modal="true" onClick={() => setViewer(null)}>
          <header>
            <strong>{viewer.name}</strong>
            <button className="avs-icon-btn" aria-label="Close image" onClick={() => setViewer(null)}><X /></button>
          </header>
          <div className="avs-image-viewer-body" onClick={(e) => e.stopPropagation()}>
            <img src={viewer.url} alt={viewer.name} />
          </div>
        </div>
      )}
    </>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="avs-messenger-shell"><LoadingState /></div>}>
      <MessagesPageInner />
    </Suspense>
  );
}
