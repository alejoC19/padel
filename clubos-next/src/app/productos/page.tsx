'use client';

import { AppShell } from '@/components/AppShell';
import { ProductsScreen } from '@/components/ProductsScreen';
import { RouteGuard } from '@/components/RouteGuard';

export default function ProductosRoute() {
  return (
    <AppShell>
      <RouteGuard requiredPermission="product.manage">
        <ProductsScreen />
      </RouteGuard>
    </AppShell>
  );
}
