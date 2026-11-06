import { Leaf } from "lucide-react";
import styles from "./inventory-skeleton.module.css";

export default function InventorySkeleton() {
  return (
    <div className={styles.shell} aria-busy="true" role="status">
      <span className={styles.srOnly}>Loading your workspace…</span>
      <div className={styles.sidebar} aria-hidden="true">
        <div className={styles.brand}>
          <Leaf size={24} />
          <span>HERBAL MAZA</span>
        </div>
        <div className={styles.navigation}>
          {Array.from({ length: 6 }, (_, index) => (
            <div className={`${styles.placeholder} ${styles.navItem}`} key={index} />
          ))}
        </div>
        <div className={`${styles.placeholder} ${styles.profile}`} />
      </div>
      <main className={styles.main} aria-hidden="true">
        <div className={styles.topbar}>
          <div className={`${styles.placeholder} ${styles.breadcrumb}`} />
          <div className={`${styles.placeholder} ${styles.avatar}`} />
        </div>
        <div className={styles.content}>
          <div className={styles.heading}>
            <div className={`${styles.placeholder} ${styles.title}`} />
            <div className={`${styles.placeholder} ${styles.subtitle}`} />
          </div>
          <div className={styles.cards}>
            {Array.from({ length: 4 }, (_, index) => (
              <div className={styles.panel} key={index}>
                <div className={`${styles.placeholder} ${styles.cardLabel}`} />
                <div className={`${styles.placeholder} ${styles.cardValue}`} />
              </div>
            ))}
          </div>
          <div className={styles.panel}>
            <div className={`${styles.placeholder} ${styles.sectionTitle}`} />
            <div className={styles.actions}>
              {Array.from({ length: 3 }, (_, index) => (
                <div className={`${styles.placeholder} ${styles.action}`} key={index} />
              ))}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={`${styles.placeholder} ${styles.sectionTitle}`} />
            <div className={`${styles.placeholder} ${styles.search}`} />
            <div className={styles.rows}>
              {Array.from({ length: 6 }, (_, index) => (
                <div className={styles.row} key={index}>
                  <div className={`${styles.placeholder} ${styles.product}`} />
                  <div className={`${styles.placeholder} ${styles.identifier}`} />
                  <div className={`${styles.placeholder} ${styles.quantity}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
