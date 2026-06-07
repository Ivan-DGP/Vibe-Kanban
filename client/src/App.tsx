import { Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

const Dashboard = lazy(() => import("@/routes/Dashboard"));
const ProjectDetail = lazy(() => import("@/routes/ProjectDetail"));
const Tasks = lazy(() => import("@/routes/Tasks"));
const Todos = lazy(() => import("@/routes/Todos"));
const Settings = lazy(() => import("@/routes/Settings"));
const Reports = lazy(() => import("@/routes/Reports"));
const Benchmarks = lazy(() => import("@/routes/Benchmarks"));
const Logs = lazy(() => import("@/routes/Logs"));
const Help = lazy(() => import("@/routes/Help"));
const ApiClient = lazy(() => import("@/routes/ApiClient"));

function Loading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <OnboardingWizard />
      <Routes>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Suspense fallback={<Loading />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="project/:projectId"
            element={
              <Suspense fallback={<Loading />}>
                <ProjectDetail />
              </Suspense>
            }
          />
          <Route
            path="tasks"
            element={
              <Suspense fallback={<Loading />}>
                <Tasks />
              </Suspense>
            }
          />
          <Route
            path="todos"
            element={
              <Suspense fallback={<Loading />}>
                <Todos />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<Loading />}>
                <Settings />
              </Suspense>
            }
          />
          <Route
            path="reports"
            element={
              <Suspense fallback={<Loading />}>
                <Reports />
              </Suspense>
            }
          />
          <Route
            path="benchmarks"
            element={
              <Suspense fallback={<Loading />}>
                <Benchmarks />
              </Suspense>
            }
          />
          <Route
            path="logs"
            element={
              <Suspense fallback={<Loading />}>
                <Logs />
              </Suspense>
            }
          />
          <Route
            path="api-client"
            element={
              <Suspense fallback={<Loading />}>
                <ApiClient />
              </Suspense>
            }
          />
          <Route
            path="help"
            element={
              <Suspense fallback={<Loading />}>
                <Help />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <span className="text-4xl font-bold">404</span>
                <span className="text-sm">Page not found</span>
              </div>
            }
          />
        </Route>
      </Routes>
    </>
  );
}
