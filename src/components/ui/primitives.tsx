import Link from "next/link";
import { clsx } from "clsx";

export function Button({
  children,
  className = "",
  variant = "primary",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const variants = {
    primary:
      "brand-gradient border-transparent text-white shadow-[0_8px_20px_rgba(24,33,45,0.12),0_2px_6px_rgba(24,33,45,0.06)] hover:shadow-[0_12px_28px_rgba(24,33,45,0.16),0_4px_10px_rgba(24,33,45,0.08)] hover:brightness-[1.04] dark:shadow-[0_10px_24px_rgba(2,8,23,0.3)] dark:hover:shadow-[0_14px_32px_rgba(2,8,23,0.38)]",
    secondary:
      "border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)] shadow-[0_4px_12px_rgba(24,33,45,0.05)] hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)] hover:shadow-[0_8px_20px_rgba(24,33,45,0.08)] dark:bg-[color:var(--surface-soft)] dark:shadow-[0_6px_16px_rgba(2,8,23,0.18)] dark:hover:shadow-[0_10px_24px_rgba(2,8,23,0.24)]",
    ghost:
      "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)] hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(24,33,45,0.05)] dark:bg-[color:var(--surface-soft)] dark:shadow-[0_4px_12px_rgba(2,8,23,0.12)]",
    danger:
      "border-transparent bg-rose-600 text-white shadow-[0_8px_20px_rgba(225,29,72,0.16)] hover:bg-rose-500 hover:shadow-[0_12px_28px_rgba(225,29,72,0.22)] dark:shadow-[0_10px_24px_rgba(136,19,55,0.26)]",
  };

  return (
    <button
      type={type}
      className={clsx(
        "inline-flex items-center justify-center rounded-[1.1rem] border px-4 py-2.5 text-sm font-semibold tracking-tight transition-[background-color,border-color,color,box-shadow,filter,transform] duration-200 ease-smooth active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)] disabled:pointer-events-none disabled:opacity-60",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  className = "",
  variant = "primary",
  prefetch = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
  prefetch?: boolean;
}) {
  const variants = {
    primary:
      "brand-gradient border-transparent text-white shadow-[0_8px_20px_rgba(24,33,45,0.12),0_2px_6px_rgba(24,33,45,0.06)] hover:shadow-[0_12px_28px_rgba(24,33,45,0.16),0_4px_10px_rgba(24,33,45,0.08)] hover:brightness-[1.04]",
    secondary:
      "border-[color:var(--border)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)] shadow-[0_4px_12px_rgba(24,33,45,0.05)] hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)] hover:shadow-[0_8px_20px_rgba(24,33,45,0.08)]",
    ghost:
      "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)] hover:border-[color:var(--brand-solid)] hover:bg-[color:var(--surface-hover)] hover:shadow-[0_4px_12px_rgba(24,33,45,0.05)]",
  };

  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={clsx(
        "inline-flex items-center justify-center rounded-[1.1rem] border px-4 py-2.5 text-sm font-semibold tracking-tight transition-[background-color,border-color,color,box-shadow,filter,transform] duration-200 ease-smooth active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)]",
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        "panel-surface relative overflow-hidden rounded-[1.7rem] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-panel ring-1 ring-white/[0.04] transition-[colors,shadow] duration-200 dark:shadow-[0_14px_32px_rgba(2,8,23,0.32)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "success" | "danger";
}) {
  const tones = {
    default: "border border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--muted)]",
    accent: "border border-[color:var(--brand-solid)]/15 bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]",
    success: "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    danger: "border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };

  return (
    <span className={clsx("inline-flex items-center rounded-full px-3 py-1 text-[0.6875rem] font-semibold tracking-[0.02em]", tones[tone])}>
      {children}
    </span>
  );
}
