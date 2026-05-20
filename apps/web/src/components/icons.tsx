import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

export function RootPilotMark({ className }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/35 bg-cyan-400/10 shadow-glow ${className ?? ''}`}
      aria-hidden="true"
    >
      <span className="absolute h-3.5 w-3.5 rotate-45 rounded-[3px] border border-cyan-200/80 bg-cyan-300/20" />
      <span className="absolute h-1.5 w-1.5 rounded-full bg-teal-300" />
    </span>
  );
}

export function Icon({ children, className, ...props }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5h6v6H4zM14 5.5h6v6h-6zM4 15h6v3.5H4zM14 15h6v3.5h-6z" />
    </Icon>
  );
}

export function ServiceMapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 7h4v4H6zM14 4h4v4h-4zM14 16h4v4h-4zM10 9h4M16 8v8" />
    </Icon>
  );
}

export function LogsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6h14M5 10h14M5 14h10M5 18h12" />
    </Icon>
  );
}

export function TracesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6h5v5H5zM14 13h5v5h-5zM10 8.5h2.5A3.5 3.5 0 0 1 16 12v1M14 15.5h-2.5A3.5 3.5 0 0 1 8 12v-1" />
    </Icon>
  );
}

export function MetricsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 18V9M10 18V5M16 18v-7M22 18H2" />
    </Icon>
  );
}

export function ServicesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3 7 4v10l-7 4-7-4V7l7-4Z" />
      <path d="m5 7 7 4 7-4M12 11v10" />
    </Icon>
  );
}

export function DeploymentsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12M8 11l4 4 4-4M5 19h14" />
      <path d="M7 7.5 12 4l5 3.5" />
    </Icon>
  );
}

export function ErrorGroupsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 4 9 16H3L12 4Z" />
      <path d="M12 10v4M12 17h.01" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.7 2.94-.08-.02a1.65 1.65 0 0 0-1.92.7l-.04.07h-3.4l-.04-.07a1.65 1.65 0 0 0-1.92-.7l-.08.02-1.7-2.94.06-.06A1.65 1.65 0 0 0 4.6 15l-.07-.04v-3.92l.07-.04a1.65 1.65 0 0 0-.33-1.82l-.06-.06 1.7-2.94.08.02a1.65 1.65 0 0 0 1.92-.7l.04-.07h3.4l.04.07a1.65 1.65 0 0 0 1.92.7l.08-.02 1.7 2.94-.06.06A1.65 1.65 0 0 0 19.4 11l.07.04v3.92l-.07.04Z" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M13.7 19a2 2 0 0 1-3.4 0" />
    </Icon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 9h10v10H9z" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m20 6-11 11-5-5" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
