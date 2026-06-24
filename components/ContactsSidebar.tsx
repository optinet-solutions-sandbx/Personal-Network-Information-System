"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";

const COLLAPSE_KEY = "networky:sidebar-collapsed";

// Primary navigation. The contacts list itself now lives on the /contacts table
// page, so the sidebar is purely a nav rail.
export default function ContactsSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Restore the collapsed preference once on mount.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
    { href: "/dashboard", label: "Dashboard", icon: <DashboardIcon /> },
    { href: "/contacts", label: "Contacts", icon: <ContactsIcon /> },
    { href: "/meetings", label: "Meetings", icon: <CalendarIcon /> },
    { href: "/network", label: "Network map", icon: <NetworkIcon /> },
    { href: "/network-intel", label: "Network intel", icon: <ChartIcon /> },
    { href: "/import", label: "Import / export", icon: <ImportIcon /> },
    { href: "/connections", label: "Connections", icon: <PlugIcon /> },
  ];

  // A nav entry is active on its exact route, or (for /contacts) on any contact
  // detail page so the Contacts item stays highlighted while viewing a contact.
  const isActive = (href: string) =>
    pathname === href || (href === "/contacts" && pathname.startsWith("/contacts/"));

  // ── Collapsed: thin icon rail ───────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="group/sidebar flex w-14 flex-shrink-0 flex-col items-center border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-3">
        <WorkspaceSwitcher collapsed />
        <nav className="flex flex-1 flex-col items-center gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                isActive(item.href)
                  ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {item.icon}
            </Link>
          ))}
        </nav>

        <div className="mt-2 flex w-full justify-center px-1 pt-2 opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 focus-within:opacity-100">
          <CollapseToggle
            onClick={toggleCollapsed}
            label="Expand navigation"
            icon={<PanelExpandIcon />}
          />
        </div>
      </aside>
    );
  }

  // ── Expanded: full sidebar ──────────────────────────────────────────────────
  return (
    <aside className="group/sidebar flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-100 pt-3 dark:border-zinc-800">
        <WorkspaceSwitcher collapsed={false} />
      </div>
      <nav className="flex-1 px-2 pt-3">
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href} active={isActive(item.href)} icon={item.icon}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex justify-end border-t border-zinc-100 dark:border-zinc-800 p-2 opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 focus-within:opacity-100">
        <CollapseToggle
          onClick={toggleCollapsed}
          label="Collapse navigation"
          icon={<PanelCollapseIcon />}
          tooltipSide="right"
        />
      </div>
    </aside>
  );
}

// Icon-only toggle button that reveals a dark tooltip "chip" on hover/focus.
// Shared by both the expanded and collapsed sidebar footers.
function CollapseToggle({
  onClick,
  label,
  icon,
  tooltipSide = "right",
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  tooltipSide?: "left" | "right";
}) {
  return (
    <div className="group/collapse relative inline-block">
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-200"
      >
        {icon}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-100 group-hover/collapse:opacity-100 dark:bg-zinc-700 ${
          tooltipSide === "left" ? "right-full mr-2" : "left-full ml-2"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// Expanded-sidebar nav row.
function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
          : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-500" />
      )}
      {icon}
      {children}
    </Link>
  );
}

// ── Icons (inline SVG, matching the stroke style used in HeaderActions) ─────────
function ContactsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function NetworkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M6.8 7.3 10.6 16M17.2 7.3 13.4 16M7 6h10" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M3 3v18h18" />
      <rect x="7" y="11" width="3" height="6" rx="0.5" />
      <rect x="13" y="7" width="3" height="10" rx="0.5" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
      <path d="M12 17v5" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function PanelCollapseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M16 9l-2 3 2 3" />
    </svg>
  );
}

function PanelExpandIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M13 9l2 3-2 3" />
    </svg>
  );
}
