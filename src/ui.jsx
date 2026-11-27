import {useEffect, useId, useRef, useState} from 'react';

export function formatMoney(value, {
  locale = 'es-MX',
  currency = 'MXN',
  minimumFractionDigits = 0,
  maximumFractionDigits = 2,
  prefix = '$',
  fallback = '—',
} = {}) {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const formatted = number.toLocaleString(locale, {minimumFractionDigits, maximumFractionDigits});
  return `${prefix}${formatted}`;
}

export function Money({value, as: Component = 'span', className = '', fallback = '—', ...options}) {
  const text = formatMoney(value, {fallback, ...options});
  return <Component className={className || undefined}>{text}</Component>;
}

function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, options = {}, locale = 'es-MX') {
  if (value == null || value === '') return '—';
  const date = toDate(value);
  if (!date) return '—';
  const formatOptions = Object.keys(options).length ? options : {day: '2-digit', month: '2-digit', year: 'numeric'};
  try {
    return date.toLocaleDateString(locale, formatOptions);
  } catch {
    return '—';
  }
}

export function formatDateTime(value, options = {}, locale = 'es-MX') {
  if (value == null || value === '') return '—';
  const date = toDate(value);
  if (!date) return '—';
  const formatOptions = Object.keys(options).length
    ? options
    : {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'};
  try {
    return date.toLocaleString(locale, formatOptions);
  } catch {
    return '—';
  }
}

export function Pill({children, className = '', status, tone, as: Component = 'span', ...rest}) {
  const classes = ['pill', status, tone, className].filter(Boolean).join(' ');
  return <Component className={classes} {...rest}>{children}</Component>;
}

export function KpiCard({label, value, hint, tone, className = '', children, valueClassName = ''}) {
  const classes = ['card', 'kpi', tone, className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {label != null && label !== '' && <span className="lbl">{label}</span>}
      {value != null && value !== '' && <strong className={['big', valueClassName].filter(Boolean).join(' ')}>{value}</strong>}
      {hint ? <small className="mut">{hint}</small> : null}
      {children}
    </div>
  );
}

export function EmptyState({title = 'Sin resultados', message, icon, action, children, className = ''}) {
  return (
    <div
      className={className || undefined}
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: 8,
        padding: '24px 16px',
        textAlign: 'center',
        color: 'var(--mut)',
      }}
    >
      {icon ? <div aria-hidden="true" style={{fontSize: 28, lineHeight: 1}}>{icon}</div> : null}
      {title ? <strong style={{color: 'var(--tx)', fontSize: 15}}>{title}</strong> : null}
      {message ? <p className="mut" style={{margin: 0, maxWidth: 520}}>{message}</p> : null}
      {children}
      {action ? <div style={{marginTop: 4}}>{action}</div> : null}
    </div>
  );
}

const ICON_PATHS = {
  close: <path d="M6 6l12 12M18 6 6 18" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  check: <path d="M5 12.5 10 17l9-10" />,
  alert: (
    <>
      <path d="M12 8v5" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
      <path d="M10.3 4.5h3.4L21 18a2 2 0 0 1-1.7 3H4.7A2 2 0 0 1 3 18z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </>
  ),
};

export function Icon({name, size = 16, className = '', title, children, strokeWidth = 1.8, ...rest}) {
  const ariaLabel = rest['aria-label'];
  const content = ICON_PATHS[name];
  if (content) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className || undefined}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={ariaLabel || title ? undefined : true}
        aria-label={ariaLabel}
        role={ariaLabel || title ? 'img' : undefined}
        focusable="false"
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {content}
      </svg>
    );
  }
  return (
    <span
      className={className || undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      style={{display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontSize: size}}
      {...rest}
    >
      {children ?? name ?? null}
    </span>
  );
}

export function ConfirmDialog({
  open,
  title = 'Confirmar',
  message,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass = tone === 'danger' || tone === 'red' ? 'btn red' : 'btn';
  return (
    <div
      className="modal"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel?.();
      }}
    >
      <section className="card" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{width: 'min(520px, 100%)'}}>
        <div className="row" style={{alignItems: 'flex-start'}}>
          <h3 id={titleId} style={{flex: 1, margin: 0}}>{title}</h3>
          <button type="button" className="btn ghost" aria-label="Cerrar" disabled={busy} onClick={onCancel}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div style={{marginTop: 12, display: 'grid', gap: 8}}>
          {message ? <p style={{margin: 0, whiteSpace: 'pre-line'}}>{message}</p> : null}
          {children}
        </div>
        <div className="row" style={{justifyContent: 'flex-end', marginTop: 18, gap: 8}}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={confirmClass} disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function RowMenu({label = 'Acciones', items = [], align = 'end', buttonClassName = '', disabled = false, children}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const hasItems = Array.isArray(items) && items.length > 0;
  const menuStyle = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    [align === 'start' ? 'left' : 'right']: 0,
    zIndex: 30,
    minWidth: 180,
    padding: 6,
    display: 'grid',
    gap: 2,
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-md)',
    boxShadow: '0 10px 30px #0005',
  };

  return (
    <div ref={rootRef} style={{position: 'relative', display: 'inline-flex'}}>
      <button
        type="button"
        className={['btn', 'ghost', buttonClassName].filter(Boolean).join(' ')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        style={{minWidth: 36, padding: '6px 10px'}}
      >
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} style={menuStyle}>
          {hasItems
            ? items.map((item, index) => {
              const toneClass = item.tone === 'danger' || item.tone === 'red' ? 'btn red' : 'btn ghost';
              return (
                <button
                  key={item.key ?? item.label ?? index}
                  type="button"
                  role="menuitem"
                  className={toneClass}
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                  style={{justifyContent: 'flex-start', width: '100%', textAlign: 'left', borderRadius: 'var(--r-sm)'}}
                >
                  {item.icon ? <span aria-hidden="true" style={{marginRight: 8, display: 'inline-flex'}}>{item.icon}</span> : null}
                  {item.label}
                </button>
              );
            })
            : children}
        </div>
      )}
    </div>
  );
}
