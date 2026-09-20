import type { CSSProperties } from "react";

/**
 * A fixed, non-interactive backdrop that sits behind every page.
 * Three large soft colour fields drift slowly, a faint dot grid drifts the
 * other way, and a couple of thin rings float — all on-theme, all low
 * contrast so page content stays perfectly legible. Motion is disabled for
 * users who prefer reduced motion (handled in styles.css).
 */

type Blob = {
  style: CSSProperties;
  tint: string;
  animation: string;
};

const blobs: Blob[] = [
  {
    tint: "var(--primary)",
    animation: "syllo-drift-a 22s ease-in-out infinite",
    style: { top: "-12%", left: "-8%", width: "46vw", height: "46vw" },
  },
  {
    tint: "var(--accent)",
    animation: "syllo-drift-b 26s ease-in-out infinite",
    style: { top: "20%", right: "-14%", width: "40vw", height: "40vw" },
  },
  {
    tint: "var(--course-blue)",
    animation: "syllo-drift-c 30s ease-in-out infinite",
    style: { bottom: "-18%", left: "18%", width: "42vw", height: "42vw" },
  },
];

export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Soft drifting colour fields */}
      {blobs.map((blob, index) => (
        <div
          key={index}
          data-syllo-drift
          className="absolute rounded-full opacity-[0.22] blur-[70px] will-change-transform"
          style={{
            ...blob.style,
            animation: blob.animation,
            backgroundImage: `radial-gradient(circle at 50% 50%, color-mix(in oklch, ${blob.tint} 70%, transparent), transparent 68%)`,
          }}
        />
      ))}

      {/* Faint dot grid, slowly drifting to add texture */}
      <div
        data-syllo-drift
        className="absolute -inset-[10%] opacity-[0.5] will-change-transform"
        style={{
          animation: "syllo-drift-b 40s ease-in-out infinite",
          backgroundImage:
            "radial-gradient(color-mix(in oklch, var(--foreground) 12%, transparent) 1px, transparent 1.4px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse at 50% 40%, black 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 40%, black 30%, transparent 78%)",
        }}
      />

      {/* Two thin floating rings */}
      <div
        data-syllo-drift
        className="absolute right-[12%] top-[16%] size-40 rounded-full will-change-transform"
        style={{
          animation: "syllo-float 12s ease-in-out infinite",
          border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
        }}
      />
      <div
        data-syllo-drift
        className="absolute bottom-[14%] right-[26%] size-24 rounded-full will-change-transform"
        style={{
          animation: "syllo-float 15s ease-in-out infinite reverse",
          border: "1px solid color-mix(in oklch, var(--primary) 26%, transparent)",
        }}
      />
    </div>
  );
}
