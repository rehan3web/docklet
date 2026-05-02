import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import SqlEditorPage from "@/pages/sql-editor";
import TableEditorPage from "@/pages/table-editor";
import StatisticsPage from "@/pages/statistics";
import VisualizerPage from "@/pages/visualizer";
import SettingsPage from "@/pages/settings";
import BackupRestorePage from "@/pages/backup-restore";
import VpsPage from "@/pages/vps";
import TerminalPage from "@/pages/terminal";
import SshPage from "@/pages/ssh";
import DockerPage from "@/pages/docker";
import ContainerDetailPage from "@/pages/docker-container";
import DeployPage from "@/pages/deploy";
import ProxyPage from "@/pages/proxy";
import SchedulerPage from "@/pages/scheduler";
import StoragePage from "@/pages/storage";
import DomainsPage from "@/pages/domains";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import { ThemeProvider } from "@/hooks/use-theme";
import { getToken } from "@/api/client";

const queryClient = new QueryClient();

function PrivateRoute({ component: Component }: { component: React.ComponentType }) {
  const [, navigate] = useLocation();
  const token = getToken();

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  if (!token) return null;
  return <Component />;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const [, navigate] = useLocation();
  const token = getToken();

  useEffect(() => {
    if (token) navigate("/");
  }, [token]);

  if (token) return null;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <PrivateRoute component={Dashboard} />}</Route>
      <Route path="/table-editor">{() => <PrivateRoute component={TableEditorPage} />}</Route>
      <Route path="/sql-editor">{() => <PrivateRoute component={SqlEditorPage} />}</Route>
      <Route path="/statistics">{() => <PrivateRoute component={StatisticsPage} />}</Route>
      <Route path="/visualizer">{() => <PrivateRoute component={VisualizerPage} />}</Route>
      <Route path="/settings">{() => <PrivateRoute component={SettingsPage} />}</Route>
      <Route path="/backup-restore">{() => <PrivateRoute component={BackupRestorePage} />}</Route>
      <Route path="/vps">{() => <PrivateRoute component={VpsPage} />}</Route>
      <Route path="/terminal">{() => <PrivateRoute component={TerminalPage} />}</Route>
      <Route path="/ssh">{() => <PrivateRoute component={SshPage} />}</Route>
      <Route path="/docker">{() => <PrivateRoute component={DockerPage} />}</Route>
      <Route path="/docker/:id">{(params) => <PrivateRoute component={() => <ContainerDetailPage />} />}</Route>
      <Route path="/deploy">{() => <PrivateRoute component={DeployPage} />}</Route>
      <Route path="/proxy">{() => <PrivateRoute component={ProxyPage} />}</Route>
      <Route path="/scheduler">{() => <PrivateRoute component={SchedulerPage} />}</Route>
      <Route path="/storage">{() => <PrivateRoute component={StoragePage} />}</Route>
      <Route path="/domains">{() => <PrivateRoute component={DomainsPage} />}</Route>
      <Route path="/login">{() => <PublicRoute component={LoginPage} />}</Route>
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
