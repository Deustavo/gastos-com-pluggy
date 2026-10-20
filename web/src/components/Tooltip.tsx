import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 6; // distância entre o alvo e a tooltip
const MARGIN = 8; // folga mínima das bordas da janela

interface Pos {
  top: number;
  left: number;
  below: boolean;
}

// Tooltip no lugar do title nativo: aparece no hover e no foco do teclado.
// Vai para o body via portal (position: fixed) para não ser cortada por containers com overflow,
// como o .table-wrap. Fica acima do alvo e desce quando não cabe; o left é preso à janela.
export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | undefined>();

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const below = a.top - t.height - GAP < MARGIN;
    const center = a.left + a.width / 2 - t.width / 2;
    setPos({
      top: below ? a.bottom + GAP : a.top - t.height - GAP,
      left: Math.min(Math.max(center, MARGIN), window.innerWidth - t.width - MARGIN),
      below,
    });
  }, [open, content]);

  // Fecha ao rolar: a posição é fixa e ficaria descolada do alvo.
  useLayoutEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(undefined);
  };

  if (content === undefined || content === null || content === "") return <>{children}</>;

  return (
    <span
      ref={anchor}
      className={`tooltip-anchor ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className={`tooltip tooltip-float ${pos?.below ? "below" : ""}`}
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
