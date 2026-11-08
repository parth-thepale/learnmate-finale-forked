import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

// ==========================================
// 1. CAPSULE BUTTON
// ==========================================
export interface CapsuleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'subtle' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isActive?: boolean;
}

export const CapsuleButton: React.FC<CapsuleButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  rightIcon,
  isActive = false,
  disabled = false,
  className = '',
  ...rest
}) => {
  const sizeClasses = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-9 px-4 text-xs font-medium gap-2',
    lg: 'h-10 px-5 text-sm font-semibold gap-2.5',
  }[size];

  const variantClasses = {
    accent: isActive
      ? 'bg-[var(--accent-terracotta-hover)] text-white border border-[var(--accent-terracotta-hover)] shadow-xs'
      : 'bg-[var(--accent-terracotta)] text-white border border-[var(--accent-terracotta)] hover:bg-[var(--accent-terracotta-hover)] shadow-xs active:translate-y-px',
    primary: isActive
      ? 'bg-[var(--text-ink)] text-[var(--bg-paper)] border border-[var(--text-ink)]'
      : 'bg-[var(--text-ink)] text-[var(--bg-paper)] border border-[var(--text-ink)] hover:opacity-90 active:translate-y-px',
    secondary: isActive
      ? 'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)] font-semibold'
      : 'bg-[var(--bg-surface)] text-[var(--text-ink)] border border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] hover:bg-[var(--bg-surface-warm)] active:translate-y-px',
    subtle: isActive
      ? 'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]'
      : 'bg-[var(--bg-surface-warm)] text-[var(--text-ink-secondary)] border border-[var(--border-paper)] hover:text-[var(--text-ink)] hover:border-[var(--border-paper-strong)] active:translate-y-px',
    outline: isActive
      ? 'bg-[var(--bg-surface-warm)] text-[var(--accent-terracotta)] border-2 border-[var(--accent-terracotta)]'
      : 'bg-transparent text-[var(--text-ink-secondary)] border border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] hover:text-[var(--text-ink)]',
    danger:
      'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40 hover:bg-red-100 dark:hover:bg-red-950/50',
  }[variant];

  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-full transition-all duration-150 select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40 ${sizeClasses} ${variantClasses} ${className}`}
      {...rest}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {children && <span className="truncate">{children}</span>}
      {rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
};

// ==========================================
// 2. CAPSULE NAV ITEM
// ==========================================
export interface CapsuleNavItemProps {
  label: string;
  icon?: React.ReactNode;
  isActive: boolean;
  badge?: string | number;
  onClick: () => void;
  className?: string;
  id?: string;
}

export const CapsuleNavItem: React.FC<CapsuleNavItemProps> = ({
  label,
  icon,
  isActive,
  badge,
  onClick,
  className = '',
  id,
}) => {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={`relative h-9 px-4 rounded-full text-xs font-medium inline-flex items-center gap-2 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40 ${
        isActive
          ? 'bg-[var(--accent-terracotta)] text-white shadow-xs font-semibold'
          : 'bg-transparent text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] hover:bg-[var(--bg-surface-warm)]'
      } ${className}`}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono leading-none ${
            isActive
              ? 'bg-white/25 text-white'
              : 'bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] border border-[var(--border-paper)]'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
};

// ==========================================
// 3. CAPSULE DROPDOWN
// ==========================================
export interface CapsuleDropdownOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  description?: string;
}

export interface CapsuleDropdownProps {
  triggerLabel: string;
  triggerIcon?: React.ReactNode;
  options: CapsuleDropdownOption[];
  selectedId?: string;
  onSelect: (option: CapsuleDropdownOption) => void;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  className?: string;
}

export const CapsuleDropdown: React.FC<CapsuleDropdownProps> = ({
  triggerLabel,
  triggerIcon,
  options,
  selectedId,
  onSelect,
  align = 'left',
  size = 'md',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const heightClass = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-xs';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-2 rounded-full border border-[var(--border-paper)] bg-[var(--bg-surface)] text-[var(--text-ink)] hover:bg-[var(--bg-surface-warm)] hover:border-[var(--border-paper-strong)] transition-all cursor-pointer font-medium select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40 ${heightClass}`}
      >
        {triggerIcon && <span className="shrink-0">{triggerIcon}</span>}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--text-ink-muted)] transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute top-full mt-1.5 min-w-[200px] py-1.5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-paper)] shadow-lg z-50 animate-in fade-in zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((opt) => {
            const isSelected = selectedId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(opt);
                  setIsOpen(false);
                }}
                className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between gap-3 hover:bg-[var(--bg-surface-warm)] transition-colors cursor-pointer ${
                  isSelected
                    ? 'text-[var(--accent-terracotta)] font-semibold bg-[var(--accent-terracotta-subtle)]'
                    : 'text-[var(--text-ink)]'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {opt.icon && <span className="shrink-0 text-current">{opt.icon}</span>}
                  <div className="truncate">
                    <div className="truncate">{opt.label}</div>
                    {opt.description && (
                      <div className="text-[10px] text-[var(--text-ink-muted)] truncate font-normal">
                        {opt.description}
                      </div>
                    )}
                  </div>
                </div>
                {opt.badge && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] border border-[var(--border-paper)]">
                    {opt.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 4. CAPSULE SEARCH
// ==========================================
export interface CapsuleSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  shortcutBadge?: string;
  className?: string;
  autoFocus?: boolean;
}

export const CapsuleSearch: React.FC<CapsuleSearchProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  onSubmit,
  onClear,
  shortcutBadge = '⌘K',
  className = '',
  autoFocus = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      onSubmit(value);
    }
    if (e.key === 'Escape' && onClear) {
      onClear();
    }
  };

  return (
    <div
      className={`relative inline-flex items-center h-9 w-full rounded-full border border-[var(--border-paper)] bg-[var(--bg-surface)] hover:border-[var(--border-paper-strong)] focus-within:border-[var(--accent-terracotta)] focus-within:ring-2 focus-within:ring-[var(--accent-terracotta)]/20 transition-all ${className}`}
    >
      <Search className="w-3.5 h-3.5 text-[var(--text-ink-muted)] ml-3.5 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full h-full px-2.5 bg-transparent text-xs text-[var(--text-ink)] placeholder-[var(--text-ink-muted)] focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            onClear?.();
            inputRef.current?.focus();
          }}
          className="mr-2 p-1 rounded-full text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] hover:bg-[var(--bg-surface-warm)] cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      ) : shortcutBadge ? (
        <span className="mr-3 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium text-[var(--text-ink-muted)] bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] select-none">
          {shortcutBadge}
        </span>
      ) : null}
    </div>
  );
};

// ==========================================
// 5. CAPSULE CHIP
// ==========================================
export interface CapsuleChipProps {
  label: string;
  icon?: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  variant?: 'default' | 'accent' | 'muted';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const CapsuleChip: React.FC<CapsuleChipProps> = ({
  label,
  icon,
  isSelected = false,
  onSelect,
  onRemove,
  variant = 'default',
  size = 'sm',
  className = '',
}) => {
  const sizeClasses = {
    xs: 'h-6 px-2.5 text-[11px] gap-1',
    sm: 'h-7 px-3 text-xs gap-1.5',
    md: 'h-8 px-3.5 text-xs gap-2',
  }[size];

  let colorClasses = '';
  if (isSelected) {
    colorClasses =
      'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border-[var(--accent-terracotta)] font-semibold shadow-xs';
  } else if (variant === 'accent') {
    colorClasses =
      'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)]';
  } else if (variant === 'muted') {
    colorClasses =
      'bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] border-[var(--border-paper)] hover:text-[var(--text-ink)]';
  } else {
    colorClasses =
      'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] hover:text-[var(--text-ink)]';
  }

  return (
    <div
      onClick={onSelect}
      className={`inline-flex items-center rounded-full border transition-all select-none cursor-pointer ${sizeClasses} ${colorClasses} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate max-w-[200px]">{label}</span>
      {isSelected && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] shrink-0" />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-current cursor-pointer"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
};

// ==========================================
// 6. CAPSULE TOGGLE
// ==========================================
export interface CapsuleToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

export const CapsuleToggle: React.FC<CapsuleToggleProps> = ({
  checked,
  onChange,
  label,
  leftIcon,
  rightIcon,
  size = 'md',
  className = '',
  ariaLabel,
}) => {
  const isSm = size === 'sm';
  const trackW = isSm ? 'w-10' : 'w-12';
  const trackH = isSm ? 'h-6' : 'h-7';
  const thumbSize = isSm ? 'w-4 h-4' : 'w-5 h-5';
  const translate = isSm
    ? checked
      ? 'translate-x-4'
      : 'translate-x-1'
    : checked
    ? 'translate-x-5'
    : 'translate-x-1';

  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer select-none ${className}`}>
      {label && <span className="text-xs text-[var(--text-ink-secondary)]">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label || 'Toggle'}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex items-center rounded-full border transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40 ${trackW} ${trackH} ${
          checked
            ? 'bg-[var(--accent-terracotta)] border-[var(--accent-terracotta)]'
            : 'bg-[var(--bg-surface-warm)] border-[var(--border-paper)]'
        }`}
      >
        <span
          className={`absolute rounded-full bg-white shadow-xs transition-transform duration-200 flex items-center justify-center ${thumbSize} ${translate}`}
        >
          {checked ? rightIcon : leftIcon}
        </span>
      </button>
    </label>
  );
};

// ==========================================
// 7. CAPSULE STATUS
// ==========================================
export interface CapsuleStatusProps {
  status: 'live' | 'idle' | 'running' | 'paused' | 'completed' | 'warning';
  label: string;
  pulsing?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export const CapsuleStatus: React.FC<CapsuleStatusProps> = ({
  status,
  label,
  pulsing = false,
  icon,
  className = '',
}) => {
  const dotColor = {
    live: 'bg-emerald-500',
    running: 'bg-[var(--accent-terracotta)]',
    paused: 'bg-amber-500',
    completed: 'bg-blue-500',
    idle: 'bg-stone-400',
    warning: 'bg-red-500',
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[10px] font-medium border border-[var(--border-paper)] bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] select-none ${className}`}
    >
      <span className="relative flex h-2 w-2">
        {pulsing && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColor}`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
      </span>
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{label}</span>
    </span>
  );
};

// ==========================================
// 8. CAPSULE CONTROL
// ==========================================
export interface CapsuleControlProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label?: string;
  isActive?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
}

export const CapsuleControl: React.FC<CapsuleControlProps> = ({
  icon,
  label,
  isActive = false,
  size = 'md',
  title,
  className = '',
  disabled = false,
  ...rest
}) => {
  const sizeClasses = size === 'sm' ? 'h-7 px-2 text-xs gap-1' : 'h-8 px-2.5 text-xs gap-1.5';

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-full border transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40 ${sizeClasses} ${
        isActive
          ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] font-semibold shadow-xs'
          : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] hover:text-[var(--text-ink)] hover:bg-[var(--bg-surface-warm)] active:translate-y-px'
      } ${className}`}
      {...rest}
    >
      <span className="shrink-0">{icon}</span>
      {label && <span className="truncate">{label}</span>}
    </button>
  );
};

// ==========================================
// 9. CAPSULE BADGE
// ==========================================
export interface CapsuleBadgeProps {
  label: string;
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'subtle';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
}

export const CapsuleBadge: React.FC<CapsuleBadgeProps> = ({
  label,
  variant = 'default',
  size = 'md',
  icon,
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'h-5 px-2 text-[10px] gap-1' : 'h-6 px-2.5 text-xs gap-1.5';

  const variantClasses = {
    default: 'bg-[var(--bg-surface-warm)] text-[var(--text-ink)] border border-[var(--border-paper)]',
    accent: 'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]/40 font-semibold',
    success: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold',
    warning: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 font-semibold',
    danger: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 font-semibold',
    info: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 font-semibold',
    neutral: 'bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] border border-[var(--border-paper)]',
    subtle: 'bg-transparent text-[var(--text-ink-secondary)] border border-[var(--border-paper)]',
  }[variant];

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium select-none ${sizeClasses} ${variantClasses} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
    </span>
  );
};

// ==========================================
// 10. CAPSULE PROGRESS PILL
// ==========================================
export interface CapsuleProgressPillProps {
  value: number; // 0 to 100
  label?: string;
  variant?: 'default' | 'accent' | 'success';
  size?: 'sm' | 'md';
  className?: string;
}

export const CapsuleProgressPill: React.FC<CapsuleProgressPillProps> = ({
  value,
  label,
  variant = 'accent',
  size = 'md',
  className = '',
}) => {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const hClass = size === 'sm' ? 'h-3.5' : 'h-5';

  const barColor = {
    default: 'bg-[var(--text-ink-muted)]',
    accent: 'bg-[var(--accent-terracotta)]',
    success: 'bg-emerald-600 dark:bg-emerald-500',
  }[variant];

  return (
    <div className={`w-full flex items-center gap-2 select-none ${className}`}>
      <div className={`relative flex-1 ${hClass} rounded-full bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {label && (
        <span className="text-[11px] font-mono font-medium text-[var(--text-ink-muted)] shrink-0">
          {label}
        </span>
      )}
    </div>
  );
};

// ==========================================
// 11. CAPSULE SEGMENTED CONTROL
// ==========================================
export interface CapsuleSegmentedControlOption<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export interface CapsuleSegmentedControlProps<T extends string = string> {
  options: readonly CapsuleSegmentedControlOption<T>[];
  selectedId: T;
  onSelect: (id: T) => void;
  className?: string;
}

export function CapsuleSegmentedControl<T extends string = string>({
  options,
  selectedId,
  onSelect,
  className = '',
}: CapsuleSegmentedControlProps<T>) {
  return (
    <div
      className={`inline-flex items-center gap-1 p-1 rounded-full bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] select-none ${className}`}
    >
      {options.map((opt) => {
        const isSelected = selectedId === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
              isSelected
                ? 'bg-[var(--bg-surface)] text-[var(--accent-terracotta)] font-semibold shadow-xs border border-[var(--border-paper)]'
                : 'text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)]'
            }`}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
