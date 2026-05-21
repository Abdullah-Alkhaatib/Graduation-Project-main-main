import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import NotFound from "@/pages/not-found";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import Teams from "@/pages/Teams";
import TeamDetail from "@/pages/TeamDetail";
import MyTeam from "@/pages/MyTeam";
import Invitations from "@/pages/Invitations";
import SupervisorRequests from "@/pages/SupervisorRequests";
import Tasks from "@/pages/Tasks";
import TaskDetail from "@/pages/TaskDetail";
import Meetings from "@/pages/Meetings";
import Notifications from "@/pages/Notifications";
import Students from "@/pages/Students";
import StudentDetail from "@/pages/StudentDetail";
import Coordinator from "@/pages/Coordinator";
import CoordinatorSupervisors from "@/pages/CoordinatorSupervisors";
import ScheduledDiscussions from "@/pages/ScheduledDiscussions";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div>;
  }
  
  if (!user) {
    return <Redirect to="/login" />;
  }

  return <Component {...rest} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
      <Route path="/teams"><ProtectedRoute component={Teams} /></Route>
      <Route path="/teams/:id"><ProtectedRoute component={TeamDetail} /></Route>
      <Route path="/my-team"><ProtectedRoute component={MyTeam} /></Route>
      <Route path="/invitations"><ProtectedRoute component={Invitations} /></Route>
      <Route path="/supervisor-requests"><ProtectedRoute component={SupervisorRequests} /></Route>
      <Route path="/tasks"><ProtectedRoute component={Tasks} /></Route>
      <Route path="/tasks/:id"><ProtectedRoute component={TaskDetail} /></Route>
      <Route path="/meetings"><ProtectedRoute component={Meetings} /></Route>
      <Route path="/notifications"><ProtectedRoute component={Notifications} /></Route>
      <Route path="/students"><ProtectedRoute component={Students} /></Route>
      <Route path="/students/:id"><ProtectedRoute component={StudentDetail} /></Route>
      <Route path="/coordinator/scheduled-discussions"><ProtectedRoute component={ScheduledDiscussions} /></Route>
      <Route path="/coordinator/supervisors"><ProtectedRoute component={CoordinatorSupervisors} /></Route>
      <Route path="/coordinator"><ProtectedRoute component={Coordinator} /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
            <Toaster />
          </AuthProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
