import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type HoverTooltipProps = {
  content: string;
  children: ReactNode;
  className?: string;
  tooltipClassName?: string;
  maxWidth?: number;
};

export default function HoverTooltip({ content, children, className, tooltipClassName, maxWidth = 320 }: HoverTooltipProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const margin = 12;
      const offset = 10;
      const rect = anchor.getBoundingClientRect();
      const tipRect = tooltip.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;

      let top = rect.top - tipRect.height - offset;
      if (top < margin) top = rect.bottom + offset;
      if (top + tipRect.height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - tipRect.height - offset);
      }

      let left = centerX - tipRect.width / 2;
      if (left < margin) left = margin;
      if (left + tipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tipRect.width - margin;
      }

      setStyle({ top, left, maxWidth });
    };

    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updatePosition);
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.cancelAnimationFrame(raf);
    };
  }, [open, content, maxWidth]);

  function cancelClose() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, 120);
  }

  if (!content) return <>{children}</>;

  return (
    <span
      className={`hover-tooltip-anchor${className ? ` ${className}` : ""}`}
      ref={anchorRef}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlur={scheduleClose}
    >
      {children}
      {open && (
        <div
          className={`hover-tooltip${tooltipClassName ? ` ${tooltipClassName}` : ""}`}
          ref={tooltipRef}
          role="tooltip"
          style={style}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {content}
        </div>
      )}
    </span>
  );
}
