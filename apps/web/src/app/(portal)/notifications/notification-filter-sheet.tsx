"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./notifications.module.css";

interface NotificationFilterSheetProps {
  open: boolean;
  activeCount: number;
  children: ReactNode;
  onClose: () => void;
  onReset: () => void;
}

export function NotificationFilterSheet({
  open,
  activeCount,
  children,
  onClose,
  onReset,
}: NotificationFilterSheetProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.filterSheetBackdrop} />
        <Dialog.Content className={styles.filterSheet}>
          <span className={styles.filterSheetHandle} aria-hidden="true" />
          <header className={styles.filterSheetHeader}>
            <Dialog.Title>
              Notification filters
              {activeCount > 0 && (
                <span className={styles.activeFilterCount}>{activeCount}</span>
              )}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Close notification filters"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className={styles.visuallyHidden}>
            Choose which notifications to show, their sort order, and display
            density.
          </Dialog.Description>
          <div className={styles.filterSheetBody}>{children}</div>
          <footer className={styles.filterSheetFooter}>
            <button
              className={styles.secondaryButton}
              onClick={onReset}
              type="button"
            >
              Reset
            </button>
            <Dialog.Close asChild>
              <button className={styles.primaryButton} type="button">
                Apply filters
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
