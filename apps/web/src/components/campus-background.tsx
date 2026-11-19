import Image from "next/image";
import { collegeBranding } from "./college-branding";
import styles from "./campus-background.module.css";

export function CampusBackground({
  dark = false,
  showCollegeLogo = false,
}: {
  dark?: boolean;
  showCollegeLogo?: boolean;
}) {
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
        {showCollegeLogo && (
          <div className={styles.emblem} data-campus-emblem>
            <div className={styles.emblemFace}>
              <Image
                src={collegeBranding.logo}
                alt=""
                width={160}
                height={160}
                sizes="(min-width: 1260px) 120px, 9vw"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
