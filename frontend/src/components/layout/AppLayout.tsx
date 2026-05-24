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
        <div className="top-strip flex h-9 items-center justify-between px-6 text-xs font-semibold tracking-wide">
          <span>Jordan University of Science and Technology</span>
          <span>{dateLabel}</span>
        </div>
        <header className="site-header flex min-h-16 items-center justify-between px-6 text-primary-foreground">
          <div className="space-y-0.5">
            <h1 className="text-lg font-extrabold leading-tight">{title || "Graduation Project Management"}</h1>
            <p className="text-xs font-medium text-primary-foreground/80">Academic Portal</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/notifications">
              <Button variant="ghost" size="icon" className="relative rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20">
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
        <main className="content-canvas flex-1 overflow-y-auto p-4 md:p-6">
          <div className="relative mx-auto w-full max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}