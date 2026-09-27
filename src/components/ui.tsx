import { useEffect, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { Check, Minus, Plus, X } from "lucide-react";
import { MODULE_COLORS } from "../store/defaults";
import { useData } from "../store/data";
import type { ID } from "../store/types";

/* ---------------- Dialog ---------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "wide" | "narrow";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size ?? ""}`} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Bestätigungen ---------------- */

interface ConfirmChoice {
  value: string;
  label: string;
  kind?: "primary" | "danger" | "default";
}
interface ConfirmRequest {
  title: string;
  message?: ReactNode;
  choices: ConfirmChoice[];
  resolve: (v: string | null) => void;
}

const useConfirmStore = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

/** Zeigt eine Rückfrage mit frei wählbaren Antworten. Liefert den gewählten Wert oder null. */
export function ask(title: string, message: ReactNode, choices: ConfirmChoice[]): Promise<string | null> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ req: { title, message, choices, resolve } });
  });
}

export async function confirmDanger(title: string, message: ReactNode, label = "Löschen"): Promise<boolean> {
  return (await ask(title, message, [{ value: "ok", label, kind: "danger" }])) === "ok";
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  if (!req) return null;
  const close = (v: string | null) => {
    useConfirmStore.setState({ req: null });
    req.resolve(v);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => close(null)}
      size="narrow"
      footer={
        <>
          <button className="btn ghost" onClick={() => close(null)}>
            Abbrechen
          </button>
          {req.choices.map((c) => (
            <button
              key={c.value}
              className={`btn ${c.kind === "danger" ? "danger" : c.kind === "primary" ? "primary" : ""}`}
              onClick={() => close(c.value)}
            >
              {c.label}
            </button>
          ))}
        </>
      }
    >
      <div className="muted">{req.message}</div>
    </Modal>
  );
}

/* ---------------- Hinweise (Toasts) ---------------- */

interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}
const useToastStore = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let toastId = 0;

export function toast(text: string, kind: Toast["kind"] = "info", ms = 3800) {
  const id = ++toastId;
  useToastStore.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  setTimeout(() => useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Eingaben ---------------- */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="track" />
      {label}
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
          role="tab"
          aria-selected={o.value === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  size,
  display,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  size?: "sm";
  /** eigene Anzeige des Werts (z. B. „∞“ für 0) */
  display?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className={`stepper ${size ?? ""}`}>
      <button onClick={() => onChange(clamp(value - step))} aria-label="weniger" disabled={value <= min}>
        <Minus size={14} />
      </button>
      <span>{display ? display(value) : `${value}${suffix ?? ""}`}</span>
      <button onClick={() => onChange(clamp(value + step))} aria-label="mehr" disabled={value >= max}>
        <Plus size={14} />
      </button>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      style={{ ["--fill" as string]: `${fill}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-picker">
      {MODULE_COLORS.map((c) => (
        <button
          key={c}
          className={`color-swatch ${c === value ? "active" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={`Farbe ${c}`}
        />
      ))}
    </div>
  );
}

export function RoundCheck({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button className={`check ${on ? "on" : ""}`} onClick={onClick} aria-label={label ?? (on ? "Erledigt" : "Offen")}>
      <Check size={12} strokeWidth={3} />
    </button>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {text && <p className="small">{text}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress">
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ---------------- Module ---------------- */

export function useModule(id: ID | null | undefined) {
  return useData((s) => (id ? s.data.modules.find((m) => m.id === id) : undefined));
}

export function ModuleSelect({
  value,
  onChange,
  allowNone = true,
  noneLabel = "Kein Modul",
  className = "select",
}: {
  value: ID | null;
  onChange: (id: ID | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}) {
  const modules = useData((s) => s.data.modules);
  const active = modules.filter((m) => !m.archived || m.id === value);
  return (
    <select className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel}</option>}
      {active.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

export function ModuleTag({ id }: { id: ID | null | undefined }) {
  const m = useModule(id);
  if (!m) return null;
  return (
    <span className="row gap-4 small muted nowrap">
      <span className="dot" style={{ background: m.color }} />
      <span className="ellipsis">{m.short || m.name}</span>
    </span>
  );
}
