import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useIsTeamLeader } from "@/hooks/use-team-leader";
import { 
  LayoutDashboard, 
  Users, 
  User, 
  Briefcase, 
  Calendar, 
  Bell, 
  LogOut,
  Mail,
  UserPlus,
  ClipboardList,
  CheckSquare,
  UserCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const isTeamLeader = useIsTeamLeader();

  if (!user) return null;

  const displayName = user.name?.trim() || "User";
  const displayRole = user.role || "user";
  const userInitial = displayName.charAt(0).toUpperCase();

  const studentLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/my-team", label: "My Team", icon: Users },
    { href: "/teams", label: "Team Board", icon: Briefcase },
    { href: "/invitations", label: "Invitations", icon: Mail },
    { href: "/tasks", label: "Tasks", icon: CheckSquare },
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/profile", label: "Profile", icon: User },
  ];

  // Add leader-only links for team leaders
  if (user.role === 'student' && isTeamLeader === true) {
    studentLinks.splice(4, 0, { href: "/supervisor-requests", label: "Supervisor Requests", icon: UserPlus });
    studentLinks.splice(7, 0, { href: "/meetings", label: "Meetings", icon: Calendar });
  }
  const supervisorLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/teams", label: "My Teams", icon: Users },
    { href: "/tasks", label: "Task Management", icon: CheckSquare },
    { href: "/meetings", label: "Meeting Requests", icon: Calendar },
    { href: "/supervisor-requests", label: "Supervisor Requests", icon: UserPlus },
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/profile", label: "Office Hours", icon: User },
  ];

  const coordinatorLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/teams", label: "All Teams", icon: Briefcase },
    { href: "/students", label: "Students", icon: Users },
    { href: "/coordinator/supervisors", label: "Supervisors", icon: UserCheck },
    { href: "/coordinator/scheduled-discussions", label: "Scheduled Discussions", icon: Calendar },
    { href: "/coordinator", label: "Coordinator Panel", icon: ClipboardList },
    { href: "/notifications", label: "Notifications", icon: Bell },
  ];

  const links = 
    user.role === "student" ? studentLinks :
    user.role === "supervisor" ? supervisorLinks :
    coordinatorLinks;

  // determine the best matching link (longest href wins when multiple match)
  const matched = links.filter((l) => location === l.href || location.startsWith(`${l.href}/`));
  const activeHref = matched.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="sidebar-panel flex h-full w-80 flex-col border-r border-sidebar-border/80 shadow-2xl">
      <div className="top-strip flex min-h-24 items-center border-b border-white/10 px-4">
        <div className="hero-panel flex w-full items-center gap-3 rounded-2xl p-4 text-primary-foreground">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-primary-foreground ring-1 ring-white/20">
            <Briefcase className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-extrabold tracking-[0.18em]">GPMS</span>
            <span className="text-xs font-medium text-white/80">JUST Academic Portal</span>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 py-4">
        <div className="sidebar-group-title mb-2 px-3">Navigation</div>
        <nav className="space-y-1.5 px-3">
          {links.map((link) => {
            const isActive = link.href === activeHref;
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <div className={cn("sidebar-link relative flex items-center gap-3 rounded-2xl px-3 py-3 transition-all cursor-pointer", isActive ? "sidebar-link-active text-primary shadow-sm" : "text-sidebar-foreground/82") }>
                  {isActive && <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-md bg-primary" />}
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", isActive ? "bg-primary/10 text-primary ring-primary/10" : "bg-sidebar-accent/60 text-sidebar-foreground/60 ring-white/0")}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <span className={cn("text-sm flex-1", isActive ? "font-semibold" : "font-medium")}>{link.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border/80 p-4">
        <div className="sidebar-user-card mb-3 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center gap-3 px-1">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold text-lg ring-1 ring-primary/10">
              {userInitial}
            </div>
            <div className="flex flex-col">
                <span className="text-sm font-semibold leading-none">{displayName}</span>
                <span className="text-xs text-muted-foreground capitalize mt-1">{displayRole}</span>
            </div>
          </div>
        </div>
        <Button variant="outline" className="w-full justify-start gap-2 border-primary/20" onClick={logout}>
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );
}