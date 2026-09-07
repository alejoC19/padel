'use client';

import { AppShell } from '@/components/AppShell';
import { ReportsScreen } from '@/components/ReportsScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function ReportesRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="report.financial">
        <ReportsScreen />
      </RouteGuard>
    </AppShell>
  );
}
