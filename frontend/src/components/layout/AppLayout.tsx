import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListNotifications } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const { user } = useAuth();
  const { data: notifications } = useListNotifications();
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(now);

  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="site-shell flex h-screen w-full overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="top-strip flex h-11 items-center justify-between border-b border-white/10 px-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90">
          <span>Jordan University of Science and Technology</span>
          <span>{dateLabel}</span>
        </div>
        <header className="site-header flex min-h-20 items-center justify-between px-6 text-primary-foreground">
          <div className="space-y-1">
            <div className="section-label border-white/20 bg-white/10 text-white/90">Academic Portal</div>
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">{title || "Graduation Project Management"}</h1>
            <p className="text-sm font-medium text-primary-foreground/85">Student, supervisor, and coordinator workspace</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/notifications">
              <Button variant="ghost" size="icon" className="relative h-11 w-11 rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20">
                <Bell className="h-5 w-5" />
                {(() => {
                  const list = Array.isArray(notifications) ? notifications : [];
                  const unread = list.filter((n) => !n.isRead).length;
                  return unread > 0 ? (
                    <Badge variant="default" className="absolute -top-2 right-0 bg-primary text-xs px-1.5 py-0 text-primary-foreground">{unread}</Badge>
                  ) : null;
                })()}
              </Button>
            </Link>
          </div>
        </header>
        <main className="content-canvas flex-1 overflow-y-auto p-3 md:p-6">
          <div className="page-frame relative mx-auto w-full max-w-7xl rounded-[1.75rem] p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}