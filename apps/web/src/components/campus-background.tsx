import styles from "./campus-background.module.css";

export function CampusBackground({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`${styles.scene}${dark ? ` ${styles.dark}` : ""}`} aria-hidden="true" data-campus-background>
      <div className={styles.floor} />
      <div className={styles.sculpture}>
        <div className={styles.stack}>
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
