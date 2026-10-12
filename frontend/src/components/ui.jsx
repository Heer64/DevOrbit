import { Plus } from 'lucide-react';

// Normalises the colour names used across the app to the design-system tone classes.
export function tone(color) {
  return ['violet', 'mint', 'orange', 'blue', 'pink', 'yellow'].includes(color) ? color : color === 'teal' ? 'teal' : 'violet';
}
export const AVATAR_TONES = ['', 'mint', 'orange', 'blue'];

export function initialsOf(name = '') {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'DO';
}

export function Avatar({ initials = 'DO', tone: toneName = '', large = false, small = false, src = '' }) {
  return (
    <div className={`avatar ${toneName} ${large ? 'large' : ''} ${small ? 'small' : ''} ${src ? 'has-photo' : ''}`}>
      {src ? <img src={src} alt="" /> : initials}
    </div>
  );
}

export function Btn({ children, onClick, secondary = false, icon: Icon, type = 'button', disabled = false, className = '' }) {
  return (
    <button type={type} disabled={disabled} className={`btn ${secondary ? 'secondary' : ''} ${className}`} onClick={onClick}>
      {Icon && <Icon size={15} />} {children}
    </button>
  );
}

export function Heading({ eyebrow, title, subtitle, action, actionText = 'Create project', actionIcon = Plus }) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <Btn icon={actionIcon} onClick={action}>{actionText}</Btn>}
    </div>
  );
}

export function EmptyPanel({ icon: Icon, title, text, onReset, resetLabel = 'Clear filters' }) {
  return (
    <div className="empty-panel">
      {Icon && <span><Icon size={21} /></span>}
      <h3>{title}</h3>
      <p>{text}</p>
      {onReset && <Btn secondary onClick={onReset}>{resetLabel}</Btn>}
    </div>
  );
}
