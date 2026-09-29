import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

// Acceso de administración a la base de pruebas (solo para preparar casos, p. ej. suspender).
const ADMIN_URL = process.env.E2E_DATABASE_ADMIN_URL ?? 'postgres://postgres@localhost/lombana_test?host=/tmp';
async function adminQuery(sql: string, params: unknown[]) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

const stamp = Date.now().toString(36);
const PASSWORD = 'clave-segura-e2e-123';

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/login?modo=registro');
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.describe.serial('flujo principal V1', () => {
  const email = `ana-${stamp}@example.com`;

  test('la portada es pública y muestra solo módulos reales', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '¿Qué necesitas lograr hoy?' })).toBeVisible();
    await expect(page.getByText('Estado de la plataforma')).toBeVisible();
    for (const intent of ['Crear', 'Automatizar', 'Vender', 'Analizar', 'Aprender', 'Encontrar', 'Resolver']) {
      await expect(page.getByRole('link', { name: intent, exact: true })).toBeVisible();
    }
  });

  test('el panel exige sesión y conserva el objetivo escrito', async ({ page }) => {
    await page.goto('/app?objetivo=Probar%20algo');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%3Fobjetivo%3DProbar/);
  });

  test('registro crea cuenta y espacio personal', async ({ page }) => {
    await signUp(page, 'Ana Prueba', email);
    await expect(page.getByText('Hola, Ana')).toBeVisible();
    await expect(page.getByText('Espacio de Ana Prueba')).toBeVisible();
    await expect(page.getByText('Aún no tienes proyectos')).toBeVisible();
  });

  test('crear proyecto, agregar pasos y ver el progreso real', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByLabel('Describe tu problema, idea u objetivo').fill('Crear un ebook sobre control de costos para restaurantes');
    await page.getByRole('button', { name: 'Crear proyecto' }).click();
    await expect(page).toHaveURL(/\/app\/proyectos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: /Crear un ebook sobre control de costos/ })).toBeVisible();

    for (const step of ['Definir el público', 'Escribir el índice']) {
      await page.getByPlaceholder('Agregar un paso…').fill(step);
      await page.getByRole('button', { name: 'Agregar' }).click();
      await expect(page.getByText(step, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('0% · 0/2')).toBeVisible();

    await page.getByRole('button', { name: 'Completar: Definir el público' }).click();
    await expect(page.getByText('50% · 1/2')).toBeVisible();
    await expect(page.getByText('Paso completado')).toBeVisible();

    await page.goto('/app');
    await expect(page.getByText('50%').first()).toBeVisible();
  });

  test('otra cuenta no ve los proyectos de la primera', async ({ page }) => {
    await signUp(page, 'Beto Prueba', `beto-${stamp}@example.com`);
    await expect(page.getByText('Aún no tienes proyectos')).toBeVisible();
    await page.goto('/app/proyectos');
    await expect(page.getByText(/control de costos/)).toHaveCount(0);
  });

  test('las herramientas muestran su estado real, sin simular uso', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/herramientas');
    await expect(page.getByText('Ebook Builder')).toBeVisible();
    await expect(page.getByText('Publicar en YouTube')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Usar' })).toHaveCount(0);
  });

  test('credenciales incorrectas muestran un error claro', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill('otra-clave-incorrecta');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Correo o contraseña incorrectos.');
  });

  test('cerrar sesión devuelve al login y protege el panel', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
  });

  test('no permite redirigir a sitios externos tras iniciar sesión', async ({ page }) => {
    await page.goto('/login?next=//evil.example.com');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/app$/);
  });

  test('tampoco con caracteres de control en el destino (/<TAB>/sitio)', async ({ page }) => {
    await page.goto('/login');
    // El campo oculto es manipulable por quien arma el enlace o el formulario.
    await page.locator('input[name="next"]').evaluate((el) => ((el as HTMLInputElement).value = '/\t/evil.example.com'));
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/app$/);
  });

  test('las cookies de sesión no son accesibles desde JavaScript', async ({ page, context }) => {
    await logIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    const session = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
    expect(session.length).toBeGreaterThan(0);
    for (const c of session) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(c.sameSite, c.name).toBe('Lax');
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain('sb-');
  });

  test('una cuenta suspendida no entra y ve un aviso claro, sin bucles', async ({ page, browser }) => {
    const suspended = `susp-${stamp}@example.com`;
    await signUp(page, 'Cuenta Suspendida', suspended);
    // Se suspende mientras la sesión sigue abierta en el navegador.
    await adminQuery(`update public.users set status = 'suspended' where email_normalized = $1`, [suspended]);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?error=cuenta$/);
    await expect(page.getByText('Esta cuenta no está activa.')).toBeVisible();
    // La sesión quedó cerrada: volver a /app pide login otra vez.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);

    const fresh = await browser.newPage();
    await logIn(fresh, suspended);
    await expect(fresh.locator('p[role="alert"]')).toHaveText(
      'Esta cuenta no está activa. Escribe a soporte si crees que es un error.',
    );
    await expect(fresh).toHaveURL(/\/login/);
    await fresh.close();
  });
});

test('ninguna página se desborda horizontalmente en móvil', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const email = `movil-${Date.now().toString(36)}@example.com`;
  await page.goto('/');
  // Mide el borde derecho real de cada elemento visible (no se deja engañar por overflow oculto),
  // excepto contenedores con desplazamiento horizontal propio (menú móvil).
  const overflow = () =>
    page.evaluate(() => {
      const scrollers = [...document.querySelectorAll('*')].filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
      });
      let max = document.documentElement.scrollWidth;
      for (const el of document.querySelectorAll('body *')) {
        if (scrollers.some((s) => s !== el && s.contains(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) max = Math.max(max, Math.ceil(r.right));
      }
      return max - window.innerWidth;
    });
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.goto('/login?modo=registro');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByLabel('Nombre').fill('Persona Con Un Nombre Bastante Largo');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('clave-segura-e2e-123');
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await expect(page).toHaveURL(/\/app$/);
  // Un proyecto de nombre largo: es el caso que rompía el diseño.
  await page.getByLabel('Describe tu problema, idea u objetivo').fill(
    'Automatizar_el_seguimiento_de_clientes_potenciales_de_mi_restaurante_con_recordatorios y un objetivo bastante largo',
  );
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(page).toHaveURL(/\/app\/proyectos\//);
  expect(await overflow(), 'detalle de proyecto').toBeLessThanOrEqual(0);
  for (const path of ['/app', '/app/proyectos', '/app/herramientas', '/app/cuenta']) {
    await page.goto(path);
    expect(await overflow(), path).toBeLessThanOrEqual(0);
  }
});
