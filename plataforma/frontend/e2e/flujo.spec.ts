/**
 * E2E del flujo completo en modo demostración (criterios §9).
 * Requiere el servidor en http://127.0.0.1:8000 (./iniciar.sh).
 */
import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

test('perfil → preparación → 3 saltos → resultado → progreso', async ({ page }) => {
  await page.request.post('/api/desconectar')
  await page.goto('/')
  const nuevo = page.getByRole('button', { name: 'Nuevo atleta' })
  if (await nuevo.isVisible().catch(() => false)) await nuevo.click()
  await page.getByPlaceholder('Ej. Valentina Ríos').fill(`E2E ${Date.now() % 10000}`)
  await page.getByRole('button', { name: /Crear y continuar/ }).click()
  await expect(page).toHaveURL(/preparar/)

  await page.getByTestId('fuente-demo').click()
  await page.getByTestId('conectar').click()
  await expect(page.getByTestId('sensor')).toHaveCount(8, { timeout: 15_000 })
  await page.getByTestId('tara').click()
  await page.getByTestId('empezar').click({ timeout: 20_000 })
  await expect(page).toHaveURL(/evaluar/)

  const esperados = [/Bien|Excelente/, /A corregir/, /Mejorable|A corregir|Bien/]
  for (const [i, esc] of [0, 1, 2].entries()) {
    await page.getByTestId(`demo-esc-${esc}`).click({ timeout: 15_000 })
    const tarjeta = page.getByTestId('tarjeta-resultado')
    await expect(tarjeta).toBeVisible({ timeout: 20_000 })
    await expect(tarjeta).toContainText(esperados[i])
    if (esc === 1) await expect(tarjeta).toContainText(/Flexiona más las rodillas/)
    if (esc === 2) await expect(page.getByTestId('aviso-asimetria')).toBeVisible()
    await expect(page.getByTestId('contador')).toHaveText(String(i + 1))
    if (i < 2) {
      await page.getByTestId('siguiente').click()
      await expect(tarjeta).toBeHidden()
    }
  }
  const fps = await page.evaluate(() => (window as unknown as { __fps: number }).__fps)
  expect(fps).toBeGreaterThanOrEqual(30)

  await page.getByTestId('ver-detalle').click()
  await expect(page.getByTestId('categoria')).toBeVisible()
  await expect(page.getByTestId('accion')).toHaveCount(3)
  await expect(page.getByTestId('aviso-medico')).toBeVisible()
  await page.getByTestId('porque').first().click()
  await expect(page.getByTestId('porque-dialogo')).toContainText(/Fuente/)
  await page.keyboard.press('Escape')

  await page.goto('/progreso')
  await expect(page.getByTestId('promedio')).toBeVisible()
  await expect(page.getByTestId('proxima-meta')).toBeVisible()
})
