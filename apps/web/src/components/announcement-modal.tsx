import { useState, useEffect } from "react";
import { Megaphone, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { CollegeBranding } from "@/components/college-branding";

export type PendingAnnouncement = {
  id: string;
  title: string;
  message: string;
  category: string;
  priority: string;
  publishAt: string | null;
  imageUrl?: string;
  requiresAcknowledgement: boolean;
  author: { fullName: string };
  receipt: {
    firstDisplayedAt: string | null;
  };
};

export function AnnouncementModal({ 
  announcement, 
  onClose 
}: { 
  announcement: PendingAnnouncement; 
  onClose: () => void;
}) {
  const [viewed, setViewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageReady, setImageReady] = useState(!announcement.imageUrl);
  const [imageFailed, setImageFailed] = useState(false);
  const [tabActive, setTabActive] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );

  useEffect(() => {
    if (!announcement.receipt.firstDisplayedAt) {
      api.post(`/announcements/${announcement.id}/display`).catch(console.error);
    }
  }, [announcement.id, announcement.receipt.firstDisplayedAt]);

  useEffect(() => {
    const update = () => setTabActive(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!imageReady || !tabActive || viewed) return;
    const timer = setTimeout(() => {
      setViewed(true);
      api.post(`/announcements/${announcement.id}/view`).catch(console.error);
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [announcement.id, imageReady, tabActive, viewed]);

  const handleAcknowledge = async () => {
    if (!viewed) return;
    setLoading(true);
    try {
      if (announcement.requiresAcknowledgement) {
        await api.post(`/announcements/${announcement.id}/acknowledge`);
      }
      onClose();
    } catch (e) {
      console.error("Failed to acknowledge", e);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityIcon = () => {
    switch(announcement.priority) {
      case "EMERGENCY":
      case "CRITICAL": return <AlertTriangle size={20} color="#ef4444" />;
      case "HIGH": return <AlertCircle size={20} color="#f97316" />;
      case "LOW": return <Info size={20} color="#3b82f6" />;
      default: return <Megaphone size={20} color="#6366f1" />;
    }
  };

  return (
    <div className="announcement-modal-overlay">
      <div className="announcement-modal card">
        <div className="announcement-modal-header">
          <CollegeBranding compact />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {getPriorityIcon()}
            <div>
              <div className="announcement-category-chip">{announcement.category.replace("_", " ")}</div>
              <h2 className="announcement-modal-title">{announcement.title}</h2>
            </div>
          </div>
        </div>
        
        <div className="announcement-modal-content">
          {announcement.imageUrl && (
            <div className="announcement-modal-image-wrapper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={announcement.imageUrl}
                alt="Announcement"
                className="announcement-modal-image"
                onLoad={() => setImageReady(true)}
                onError={() => {
                  setImageReady(true);
                  setImageFailed(true);
                }}
              />
              {!imageReady && <div className="announcement-image-skeleton" aria-label="Loading announcement image" />}
            </div>
          )}

          {imageFailed && (
            <div className="warning-box" role="status">
              The announcement image could not be loaded. The message is still available below.
            </div>
          )}
          
          <div className="announcement-modal-message">
            {announcement.message.split("\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          
          <div className="announcement-modal-meta muted">
            <div>Sent by {announcement.author.fullName}</div>
            {announcement.publishAt && <div>Published {new Date(announcement.publishAt).toLocaleDateString()}</div>}
          </div>
        </div>
        
        <div className="announcement-modal-footer">
          <button 
            className="btn btn-primary" 
            style={{ width: "100%", justifyContent: "center" }}
            onClick={handleAcknowledge}
            disabled={!viewed || loading}
          >
            {announcement.requiresAcknowledgement ? "I Have Read This" : "Continue to Dashboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
