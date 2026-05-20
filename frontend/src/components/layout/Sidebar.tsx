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
  Settings, 
  LogOut,
  Mail,
  UserPlus,
  ClipboardList,
  CheckSquare,
  Activity,
  UserCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import StudentIdBadge from "@/components/StudentIdBadge";
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
    <div className="flex h-full w-64 flex-col border-r sidebar-glass">
      <div className="flex h-14 items-center border-b px-4">
        <div className="flex items-center gap-3 font-extrabold text-lg gradient-bg p-2 rounded-md text-primary-foreground w-100">
          <Briefcase className="h-6 w-6 text-primary-foreground" />
          <span className="tracking-tight">GPMS</span>
        </div>
      </div>

      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-2">
          {links.map((link) => {
            const isActive = link.href === activeHref;
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <div className={cn("relative flex items-center gap-3 rounded-md px-3 py-2 transition-colors cursor-pointer", isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-hover") }>
                  {/* left active indicator */}
                  {isActive && <span className="absolute left-0 top-0 h-full w-1 rounded-r-md bg-primary" />}
                  <Icon className={cn("h-5 w-5 flex-shrink-0", isActive ? "text-primary" : "text-sidebar-foreground/60")} />
                  <span className={cn("text-sm flex-1", isActive ? "font-semibold" : "font-medium")}>{link.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="border-t p-4">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg">
            {userInitial}
          </div>
          <div className="flex flex-col">
              <span className="text-sm font-semibold leading-none">{displayName}</span>
              <div className="mt-1">
                {/* <StudentIdBadge userId={user.id} /> */}
              </div>
              <span className="text-xs text-muted-foreground capitalize mt-1">{displayRole}</span>
          </div>
        </div>
        <Button variant="outline" className="w-full justify-start gap-2" onClick={logout}>
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );
}