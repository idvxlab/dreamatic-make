import { useEffect, useRef, useState } from "react";
import { ChevronDown, Command, LayoutDashboard, Settings } from "lucide-react";
import type { T } from "../i18n";

export function BrandMenu({
  t,
  onWorkspace,
  onSettings,
  settingsDisabled,
}: {
  t: T;
  onWorkspace: () => void;
  onSettings: () => void;
  settingsDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    area.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!area.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function choose(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }
  return (
    <div
      className="brand-area"
      ref={area}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === "Tab") setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="brand"
        aria-label={t("Dreamatic·Make 菜单", "Dreamatic·Make menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "brand-menu" : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="brand-mark">
          <Command size={20} />
        </span>
        <span>
          Dreamatic·Make<span className="brand-sub">PROTOTYPING</span>
        </span>
        <ChevronDown
          size={14}
          className={open ? "menu-chevron expanded" : "menu-chevron"}
        />
      </button>
      {open && (
        <div
          id="brand-menu"
          className="brand-menu"
          role="menu"
          aria-label={t("Dreamatic·Make 菜单", "Dreamatic·Make menu")}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]:not(:disabled)',
              ),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }}
        >
          <div className="brand-menu-caption">
            Dreamatic·Make <span>v0.1.0</span>
          </div>
          <button role="menuitem" onClick={() => choose(onWorkspace)}>
            <LayoutDashboard size={16} />
            {t("工作台", "Workspace")}
          </button>
          <button
            role="menuitem"
            disabled={settingsDisabled}
            onClick={() => choose(onSettings)}
          >
            <Settings size={16} />
            {t("系统设置", "Settings")}
          </button>
        </div>
      )}
    </div>
  );
}
