import { CSSProperties } from "react";
import styles from "./CubeLoader.module.css";

export function CubeLoader({ size }: { size?: number }) {
  return (
    <div
      className={styles.spinner}
      style={{ "--size": `${size ?? 32}px` } as CSSProperties}
    >
      <div></div>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
    </div>
  );
}
