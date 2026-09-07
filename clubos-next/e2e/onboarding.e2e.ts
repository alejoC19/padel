import { test, expect } from '@playwright/test';

/**
 * E2E del alta de club (el flujo que convierte a ClubOS en un SaaS).
 *
 * Recorre el wizard de 3 pasos como lo haría un dueño real: datos del club →
 * cuenta → confirmar → cae en la agenda ya logueado. Usa un slug/email únicos
 * por corrida para no chocar con datos previos.
 *
 * Requiere el frontend (:3001) y la API con base de test corriendo.
 */

const stamp = Date.now();
const slug = `e2e-club-${stamp}`;
const email = `duenio-${stamp}@e2e.test`;

test.describe('Onboarding de un club', () => {
  test('un dueño crea su club de punta a punta', async ({ page }) => {
    await page.goto('/crear-club');

    // --- Paso 1: Club ---
    await expect(page.getByRole('heading', { name: 'Tu club' })).toBeVisible();

    await page.getByLabel('Nombre del club').fill('Pádel E2E Center');
    // El slug se autocompleta; lo sobrescribimos por uno único.
    const slugInput = page.getByLabel('Dirección web');
    await slugInput.fill(slug);

    // Esperar el chequeo de disponibilidad en vivo.
    await expect(page.getByText('✓ Disponible')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Continuar' }).click();

    // --- Paso 2: Dueño ---
    await expect(page.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible();

    await page.getByLabel('Nombre', { exact: true }).fill('Alejo');
    await page.getByLabel('Apellido').fill('Pérez');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña').fill('Prueba1234');

    await page.getByRole('button', { name: 'Continuar' }).click();

    // --- Paso 3: Confirmar ---
    await expect(page.getByRole('heading', { name: 'Confirmá y empezá' })).toBeVisible();
    // El resumen muestra lo cargado.
    await expect(page.getByText(`${slug}.clubos.com`)).toBeVisible();
    await expect(page.getByText('Pádel E2E Center')).toBeVisible();

    await page.getByRole('button', { name: 'Crear mi club' }).click();

    // --- Éxito → redirige a la agenda ---
    await expect(page.getByText('¡Tu club está listo!')).toBeVisible({ timeout: 10_000 });
    await page.waitForURL('**/agenda', { timeout: 10_000 });
  });

  test('no deja avanzar sin los datos mínimos del club', async ({ page }) => {
    await page.goto('/crear-club');
    // Sin nombre ni slug válido, el botón Continuar está deshabilitado.
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
});
