import React, { useState } from "react";
import { Menu, LogOut, Server, Terminal, Container, GitBranch, Globe, PlugZap, Clock } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
    Drawer,
    DrawerContent,
    DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { clearToken } from "@/api/client";

export function IconDashboard({ className }: { className?: string }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
            <path d="M9.43414 20.803V13.0557C9.43414 12.5034 9.88186 12.0557 10.4341 12.0557H14.7679C15.3202 12.0557 15.7679 12.5034 15.7679 13.0557V20.803M12.0181 3.48798L5.53031 7.9984C5.26145 8.18532 5.10114 8.49202 5.10114 8.81948L5.10117 18.803C5.10117 19.9075 5.9966 20.803 7.10117 20.803H18.1012C19.2057 20.803 20.1012 19.9075 20.1012 18.803L20.1011 8.88554C20.1011 8.55988 19.9426 8.25462 19.6761 8.06737L13.1639 3.49088C12.8204 3.24951 12.3627 3.24836 12.0181 3.48798Z" />
        </svg>
    );
}

export function IconTableEditor({ className }: { className?: string }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
            <path d="M2.9707 15.3494L20.9707 15.355M20.9405 9.61588H2.99699M8.77661 9.61588V21.1367M20.9405 5.85547V19.1367C20.9405 20.2413 20.0451 21.1367 18.9405 21.1367H4.99699C3.89242 21.1367 2.99699 20.2413 2.99699 19.1367V5.85547C2.99699 4.7509 3.89242 3.85547 4.99699 3.85547H18.9405C20.0451 3.85547 20.9405 4.7509 20.9405 5.85547Z" />
        </svg>
    );
}

export function IconSQLEditor({ className }: { className?: string }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
            <path d="M7.89844 8.4342L11.5004 12.0356L7.89844 15.6375M12 15.3292H16.5M5 21.1055H19C20.1046 21.1055 21 20.21 21 19.1055V5.10547C21 4.0009 20.1046 3.10547 19 3.10547H5C3.89543 3.10547 3 4.0009 3 5.10547V19.1055C3 20.21 3.89543 21.1055 5 21.1055Z" />
        </svg>
    );
}

export function IconStatistics({ className }: { className?: string }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
            <path d="M3.03479 9.0849L8.07241 4.0575C8.46296 3.66774 9.0954 3.66796 9.48568 4.05799L14.0295 8.59881C14.42 8.98912 15.053 8.98901 15.4435 8.59857L20.5877 3.45418M16.4996 3.01526H19.9996C20.5519 3.01526 20.9996 3.46297 20.9996 4.01526V7.51526M2.99963 12.0153L2.99963 20.1958C2.99963 20.7481 3.44735 21.1958 3.99963 21.1958L20.0004 21.1958C20.5527 21.1958 21.0004 20.7481 21.0004 20.1958V9.88574M8.82532 9.87183L8.82531 21.1958M15.1754 15.0746V21.1949" />
        </svg>
    );
}

export function IconVisualizer({ className }: { className?: string }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
            <path d="M3 3v18h18M7 16l4-4 4 4 4-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconBackupRestore({ className }: { className?: string }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
        </svg>
    );
}

function IconUser() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M7.06473 19.6328C4.61648 18.0244 3 15.2537 3 12.1055C3 7.13491 7.02944 3.10547 12 3.10547C16.9706 3.10547 21 7.13491 21 12.1055C21 15.2537 19.4273 18.0094 16.979 19.6178M16.9799 22.2844V19.7136C16.9799 17.0258 14.8011 14.8469 12.1133 14.8469C9.42547 14.8469 7.24658 17.0258 7.24658 19.7136V22.2844M15 11.8469C15 13.5038 13.6569 14.8469 12 14.8469C10.3431 14.8469 9 13.5038 9 11.8469C9 10.1901 10.3431 8.84692 12 8.84692C13.6569 8.84692 15 10.1901 15 11.8469Z" />
        </svg>
    );
}

export function IconSettings({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function ThemeLogo({ hClass }: { hClass: string }) {
    const { theme } = useTheme();
    return (
        <div className={cn("flex items-center justify-center", hClass)}>
            <img
                src={theme === "dark" ? "/dark.png" : "/white.png"}
                alt="Docklet"
                className="max-h-full w-auto object-contain"
            />
        </div>
    );
}

type NavItem = {
    label: string;
    icon: React.ReactNode;
    href: string;
};

const navItems: NavItem[] = [
    { label: "Dashboard", icon: <IconDashboard />, href: "/" },
    { label: "Table Editor", icon: <IconTableEditor />, href: "/table-editor" },
    { label: "SQL Editor", icon: <IconSQLEditor />, href: "/sql-editor" },
    { label: "Statistics", icon: <IconStatistics />, href: "/statistics" },
    { label: "Visualizer", icon: <IconVisualizer />, href: "/visualizer" },
    { label: "Backup & Restore", icon: <IconBackupRestore />, href: "/backup-restore" },
    { label: "VPS", icon: <Server className="w-4 h-4" strokeWidth={1.5} />, href: "/vps" },
    { label: "AI Terminal", icon: <Terminal className="w-4 h-4" strokeWidth={1.5} />, href: "/terminal" },
    { label: "SSH", icon: <PlugZap className="w-4 h-4" strokeWidth={1.5} />, href: "/ssh" },
    { label: "Docker", icon: <Container className="w-4 h-4" strokeWidth={1.5} />, href: "/docker" },
    { label: "Auto Deploy", icon: <GitBranch className="w-4 h-4" strokeWidth={1.5} />, href: "/deploy" },
    { label: "Reverse Proxy", icon: <Globe className="w-4 h-4" strokeWidth={1.5} />, href: "/proxy" },
    { label: "Scheduler", icon: <Clock className="w-4 h-4" strokeWidth={1.5} />, href: "/scheduler" },
];

function NavLink({ item, onSelect }: { item: NavItem; onSelect?: () => void }) {
    const [location] = useLocation();
    const active = location === item.href;
    return (
        <Link
            href={item.href}
            onClick={() => onSelect?.()}
            className={cn(
                "flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 w-full text-left group cursor-pointer",
                active
                    ? "bg-muted text-foreground border border-border shadow-sm"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
            )}
        >
            <span className={cn("transition-colors shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                {item.icon}
            </span>
            {item.label}
        </Link>
    );
}

function SidebarNav({ onSelect }: { onSelect?: () => void }) {
    return (
        <nav className="flex flex-col gap-0.5 p-3">
            <NavLink item={navItems[0]} onSelect={onSelect} />
            <NavLink item={navItems[1]} onSelect={onSelect} />
            <NavLink item={navItems[2]} onSelect={onSelect} />

            <div className="h-px bg-border/50 my-2 mx-2" />

            <NavLink item={navItems[3]} onSelect={onSelect} />
            <NavLink item={navItems[4]} onSelect={onSelect} />

            <div className="h-px bg-border/50 my-2 mx-2" />

            <NavLink item={navItems[5]} onSelect={onSelect} />

            <div className="h-px bg-border/50 my-2 mx-2" />

            <NavLink item={navItems[6]} onSelect={onSelect} />
            <NavLink item={navItems[7]} onSelect={onSelect} />
            <NavLink item={navItems[8]} onSelect={onSelect} />
            <NavLink item={navItems[9]} onSelect={onSelect} />
            <NavLink item={navItems[10]} onSelect={onSelect} />
            <NavLink item={navItems[11]} onSelect={onSelect} />
            <NavLink item={navItems[12]} onSelect={onSelect} />
        </nav>
    );
}

function SidebarBrand() {
    return (
        <div className="px-5 py-5 border-b border-border/60">
            <ThemeLogo hClass="h-8" />
        </div>
    );
}

function SidebarBottom({ onSelect }: { onSelect?: () => void }) {
    const [location] = useLocation();
    const settingsActive = location === "/settings";

    return (
        <div className="mt-auto border-t border-border/60">
            <div className="p-3 flex flex-col gap-1">
                <Link
                    href="/settings"
                    onClick={() => onSelect?.()}
                    className={cn(
                        "flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 w-full text-left group cursor-pointer",
                        settingsActive
                            ? "bg-muted text-foreground border border-border shadow-sm"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
                    )}
                >
                    <span className={cn("transition-colors shrink-0", settingsActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                        <IconSettings />
                    </span>
                    Settings
                </Link>
            </div>

            <div className="px-3 pb-4">
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/40 border border-border/60 group/user">
                    <div className="shrink-0 text-muted-foreground">
                        <IconUser />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground leading-none truncate">Admin</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-none font-mono truncate">Docklet</p>
                    </div>
                    <button
                        onClick={() => {
                            clearToken();
                            window.location.href = "/login";
                        }}
                        className="ml-auto text-muted-foreground hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-500/10"
                        title="Logout"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export function DesktopSidebar() {
    return (
        <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-border bg-background/95 h-screen sticky top-0 overflow-y-auto">
            <SidebarBrand />
            <SidebarNav />
            <SidebarBottom />
        </aside>
    );
}

export function MobileSidebarTrigger() {
    const isMobile = useIsMobile();
    const [open, setOpen] = useState(false);

    if (!isMobile) return null;

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    aria-label="Open navigation"
                >
                    <Menu className="w-4 h-4" />
                </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[80vh] pb-safe">
                <div className="overflow-y-auto flex flex-col">
                    <div className="px-5 pt-4 pb-2 border-b border-border/60">
                        <ThemeLogo hClass="h-8" />
                    </div>
                    <SidebarNav onSelect={() => setOpen(false)} />
                    <SidebarBottom onSelect={() => setOpen(false)} />
                </div>
            </DrawerContent>
        </Drawer>
    );
}
