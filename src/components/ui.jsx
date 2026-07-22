import React from 'react';
import { createRoot } from 'react-dom/client';
import { eventTypeEmoji } from '../lib/eventTypes.js';

export const TIER_COLORS = {
  1: { bg: 'bg-tier-1/10', border: 'border-tier-1/40', dot: 'bg-tier-1', text: 'text-tier-1' },
  2: { bg: 'bg-tier-2/10', border: 'border-tier-2/40', dot: 'bg-tier-2', text: 'text-tier-2' },
  3: { bg: 'bg-tier-3/10', border: 'border-tier-3/40', dot: 'bg-tier-3', text: 'text-tier-3' },
  4: { bg: 'bg-tier-4/10', border: 'border-tier-4/40', dot: 'bg-tier-4', text: 'text-tier-4' },
  5: { bg: 'bg-tier-5/10', border: 'border-tier-5/40', dot: 'bg-tier-5', text: 'text-tier-5' },
  6: { bg: 'bg-tier-6/10', border: 'border-tier-6/40', dot: 'bg-tier-6', text: 'text-tier-6' },
};

export function TierDot({ tier, className = '' }) {
  const c = TIER_COLORS[tier] || TIER_COLORS[1];
  return <span className={`inline-block w-2 h-2 rounded-full ${c.dot} ${className}`} />;
}

export function Card({ children, className = '', onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-card border border-border rounded-xl ${onClick ? 'cursor-pointer hover:border-border/80 active:scale-[0.998] transition' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, valueClass = '', sub }) {
  return (
    <Card className="px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-text mt-0.5 truncate">{sub}</div>}
      <div className="text-xs text-muted uppercase tracking-wide mt-0.5">{label}</div>
    </Card>
  );
}

export function Pill({ children, color = 'gray' }) {
  const colors = {
    green:  'bg-accent/15 text-accent border-accent/30',
    red:    'bg-danger/15 text-danger border-danger/30',
    amber:  'bg-warn/15 text-warn border-warn/30',
    gray:   'bg-border text-muted border-border',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${colors[color]}`}>
      {children}
    </span>
  );
}

export function Button({ children, onClick, variant = 'primary', className = '', type = 'button', disabled }) {
  const base = 'px-4 py-2 rounded-lg text-sm font-medium transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-accent text-bg hover:bg-accent/90',
    secondary: 'bg-card border border-border hover:border-muted text-text',
    danger: 'bg-danger/10 border border-danger/40 text-danger hover:bg-danger/20',
    ghost: 'text-muted hover:text-text',
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Input({ value, onChange, placeholder, type = 'text', className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:border-accent ${className}`}
    />
  );
}

export function Select({ value, onChange, options, className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function fmtToPar(n) {
  if (n == null) return '—';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

export function StatusBadge({ status }) {
  switch (status) {
    case 'made_cut':   return <Pill color="green">Made cut</Pill>;
    case 'missed_cut': return <Pill color="red">MC</Pill>;
    case 'withdrawn':  return <Pill color="red">WD</Pill>;
    case 'playing':    return <Pill color="amber">Playing</Pill>;
    default:           return <Pill color="gray">{status}</Pill>;
  }
}

// ─── Non-blocking confirm/alert ───────────────────────────────────────────
// window.confirm()/alert() freeze the main thread for as long as they're
// open, and browsers/perf tools attribute that entire wait time to whatever
// click handler triggered them — which tanks INP. These render a real modal
// instead and resolve a Promise, so the main thread never actually blocks.

function DialogShell({ children, onBackdropClick }) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center px-4"
      onClick={onBackdropClick}
    >
      <div
        className="bg-card border border-border rounded-xl w-full max-w-sm p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ message, danger, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return (
    <DialogShell onBackdropClick={onCancel}>
      <div className="text-sm whitespace-pre-line">{message}</div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </DialogShell>
  );
}

function AlertDialog({ message, onClose }) {
  return (
    <DialogShell onBackdropClick={onClose}>
      <div className="text-sm whitespace-pre-line">{message}</div>
      <div className="flex justify-end">
        <Button onClick={onClose}>OK</Button>
      </div>
    </DialogShell>
  );
}

function mountDialog(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(node);
  return () => {
    root.unmount();
    container.remove();
  };
}

/** Promise<boolean> — resolves true/false instead of blocking the thread. */
export function confirmAsync(message, opts = {}) {
  const { danger = false, confirmLabel = 'OK', cancelLabel = 'Cancel' } = opts;
  return new Promise((resolve) => {
    const unmount = mountDialog(
      <ConfirmDialog
        message={message}
        danger={danger}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={() => { unmount(); resolve(true); }}
        onCancel={() => { unmount(); resolve(false); }}
      />
    );
  });
}

/** Promise<void> — resolves when dismissed instead of blocking the thread. */
export function alertAsync(message) {
  return new Promise((resolve) => {
    const unmount = mountDialog(
      <AlertDialog message={message} onClose={() => { unmount(); resolve(); }} />
    );
  });
}

// ─── Trophy case (major-win emoji summary + detail popup) ─────────────────

/** Clickable emoji string (from lib/majors.js's trophyCaseEmojis). Renders
 * nothing if there are no wins to show, so callers can use it unconditionally. */
export function TrophyCase({ emojis, onClick }) {
  if (!emojis) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick?.(); } }}
      className="text-sm leading-none hover:opacity-70 transition cursor-pointer inline-block"
      title="View win history"
    >
      {emojis}
    </span>
  );
}

export function TrophyCaseModal({ name, wins, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{name}'s trophy case</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        {!wins?.length ? (
          <div className="text-sm text-muted">No major wins yet.</div>
        ) : (
          <div className="space-y-2">
            {wins.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>{eventTypeEmoji(w.eventType) || '🏅'}</span>
                <span className="text-text">{w.major}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
