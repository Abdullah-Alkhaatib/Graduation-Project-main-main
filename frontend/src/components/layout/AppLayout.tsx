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

  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="site-header gradient-bg flex h-14 items-center justify-between px-6 text-primary-foreground">
          <h1 className="text-lg font-semibold">{title || "Graduation Project Management"}</h1>
          <div className="flex items-center gap-4">
            <Link href="/notifications">
              <Button variant="ghost" size="icon" className="relative rounded-full">
                <Bell className="h-5 w-5" />
                {(() => {
                  const list = Array.isArray(notifications) ? notifications : [];
                  const unread = list.filter((n) => !n.isRead).length;
                  return unread > 0 ? (
                    <Badge variant="default" className="absolute -top-2 right-0 text-xs px-1.5 py-0">{unread}</Badge>
                  ) : null;
                })()}
              </Button>
            </Link>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}