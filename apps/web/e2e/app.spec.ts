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

  test('Product Lab: producto gratis, enviar a revisión y volver a borrador', async ({ page }) => {
    await logIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole('link', { name: /Productos/ }).first().click();
    await expect(page.getByText('Aún no tienes productos')).toBeVisible();
    await page.getByRole('link', { name: 'Nuevo producto' }).click();
    await page.getByLabel('Título').fill('Guía de costos para restaurantes');
    await page.getByLabel('Descripción').fill('Plantilla y pasos para calcular el costo de cada plato.');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page).toHaveURL(/\/app\/productos\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('product-status')).toHaveText('Borrador');
    await expect(page.getByText(/Gratis$/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Enviar a revisión' }).click();
    await expect(page.getByTestId('product-status')).toHaveText('En revisión');
    await expect(page.getByText(/ningún producto se publica automáticamente/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Volver a borrador' }).click();
    await expect(page.getByTestId('product-status')).toHaveText('Borrador');
  });

  test('Product Lab: el precio de pago respeta el mínimo de US$5', async ({ page }) => {
    await logIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/productos/nuevo');
    await page.getByLabel('Título').fill('Pack de plantillas premium');
    await page.getByLabel('De pago').check();
    await page.getByLabel(/Precio en dólares/).fill('3');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('El precio mínimo es US$5.00.');
    // Lo escrito no se pierde tras el error.
    await expect(page.getByLabel('Título')).toHaveValue('Pack de plantillas premium');
    await expect(page.getByLabel(/Precio en dólares/)).toHaveValue('3');

    await page.getByLabel(/Precio en dólares/).fill('5,50');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page).toHaveURL(/\/app\/productos\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/US\$5\.50/).first()).toBeVisible();
    await expect(page.getByText(/Los pagos aún no están habilitados/)).toBeVisible();

    // Editar en borrador: bajar el precio por debajo del mínimo tampoco se permite.
    await page.getByLabel(/Precio en dólares/).fill('4.99');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('El precio mínimo es US$5.00.');
    await page.getByLabel(/Precio en dólares/).fill('9');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toHaveText('Cambios guardados.');
    await expect(page.getByText(/US\$9\.00/).first()).toBeVisible();

    await page.goto('/app/productos');
    await expect(page.getByText('Pack de plantillas premium')).toBeVisible();
    await expect(page.getByText('Guía de costos para restaurantes')).toBeVisible();
  });

  test('LOMBANA NEWS: aporte con moderación y publicación en el periódico', async ({ page }) => {
    await page.goto('/noticias');
    await expect(page.getByRole('heading', { name: 'LOMBANA NEWS' })).toBeVisible();
    await expect(page.getByText('Todavía no hay titulares.')).toBeVisible();

    await logIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/noticias');
    const title = `La IA en restaurantes ${stamp}`;
    await page.getByLabel('Título').fill(title);
    await page.getByLabel('Tu aporte').fill('Corto');
    await page.getByLabel('Enlaces de referencia (uno por línea, máximo 5)').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Enviar a moderación' }).first().click();
    // El navegador exige 80 caracteres antes de enviar; con texto suficiente, el servidor valida los enlaces.
    await page.getByLabel('Tu aporte').fill('Los restaurantes pequeños empiezan a usar modelos de lenguaje para planear compras y reducir desperdicio de alimentos.');
    await page.getByRole('button', { name: 'Enviar a moderación' }).first().click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Los enlaces deben empezar por https://');
    await expect(page.getByLabel('Título')).toHaveValue(title);

    await page.getByLabel('Enlaces de referencia (uno por línea, máximo 5)').fill('https://example.com/estudio');
    await page.getByRole('button', { name: 'Enviar a moderación' }).first().click();
    await expect(page.getByRole('status')).toHaveText('Aporte guardado.');
    await expect(page.getByTestId('contribution-status').first()).toHaveText('En moderación');

    // No aparece en el periódico hasta que moderación lo apruebe.
    await page.goto('/noticias');
    await expect(page.getByText(title)).toHaveCount(0);

    // Moderación (fuera de la app, con rol privilegiado) lo aprueba.
    await adminQuery(
      `update public.news_contributions c
          set status = 'approved', moderated_by = c.author_id, moderated_at = now(), published_at = now()
        where title = $1`,
      [title],
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: title }).getByRole('link', { name: 'example.com' }),
    ).toBeVisible();

    // Ya publicado, su autor no puede editarlo ni retirarlo desde la app.
    await page.goto('/app/noticias');
    await expect(page.getByTestId('contribution-status').first()).toHaveText('Publicado');
    await expect(page.getByRole('button', { name: 'Retirar' })).toHaveCount(0);
  });

  test('Moderación: solo moderadores, con nota obligatoria y sin publicar productos sin archivo', async ({ page, browser }) => {
    // Ana (sin rol de plataforma) no ve la moderación.
    await logIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', { name: /Moderación/ })).toHaveCount(0);
    const res = await page.goto('/app/moderacion');
    expect(res?.status()).toBe(404);

    // Ana envía un aporte y un producto a revisión.
    await page.goto('/app/noticias');
    const title = `Chips para IA en 2026 ${stamp}`;
    await page.getByLabel('Título').fill(title);
    await page.getByLabel('Tu aporte').fill('Los fabricantes compiten por chips especializados en inferencia, más baratos y eficientes que las GPU generales.');
    await page.getByRole('button', { name: 'Enviar a moderación' }).first().click();
    await expect(page.getByRole('status')).toHaveText('Aporte guardado.');
    await page.goto('/app/productos/nuevo');
    await page.getByLabel('Título').fill(`Checklist de lanzamiento ${stamp}`);
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page).toHaveURL(/\/app\/productos\/[0-9a-f-]{36}$/);
    const productUrl = page.url();
    await page.getByRole('button', { name: 'Enviar a revisión' }).click();
    await expect(page.getByTestId('product-status')).toHaveText('En revisión');

    // Un moderador de plataforma revisa.
    const modPage = await browser.newPage();
    const modEmail = `mod-${stamp}@example.com`;
    await signUp(modPage, 'Mónica Moderadora', modEmail);
    await adminQuery(
      `insert into public.platform_role_assignments (user_id, role_code)
       select id, 'ADMIN' from public.users where email_normalized = $1`,
      [modEmail],
    );
    await modPage.goto('/app/moderacion');
    await expect(modPage.getByRole('heading', { name: 'Moderación', level: 1 })).toBeVisible();
    const contribution = modPage.getByRole('listitem').filter({ hasText: title });
    await contribution.getByRole('button', { name: 'Rechazar' }).click();
    await expect(contribution.locator('p[role="alert"]')).toHaveText('Rechazar exige una nota para el autor');
    await contribution.getByRole('button', { name: 'Aprobar y publicar' }).click();
    await expect(contribution.getByRole('status')).toHaveText('Aporte publicado.');

    const product = modPage.getByRole('listitem').filter({ hasText: `Checklist de lanzamiento ${stamp}` });
    await product.getByRole('button', { name: 'Publicar' }).click();
    await expect(product.locator('p[role="alert"]')).toHaveText(
      'El producto no tiene un archivo entregable escaneado como limpio',
    );
    await product.getByLabel(/Nota para el autor/).fill('Falta subir el archivo del checklist');
    await product.getByRole('button', { name: 'Devolver a borrador' }).click();
    await expect(product.getByRole('status')).toHaveText('Producto devuelto a borrador con nota.');
    await modPage.close();

    // El aporte aparece en el periódico y Ana ve la nota del producto.
    await page.goto('/noticias');
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.goto(productUrl);
    await expect(page.getByTestId('product-status')).toHaveText('Borrador');
    await expect(page.getByTestId('review-note')).toHaveText('Revisión: Falta subir el archivo del checklist');
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
  for (const path of ['/noticias', '/app', '/app/proyectos', '/app/productos', '/app/productos/nuevo', '/app/noticias', '/app/herramientas', '/app/cuenta']) {
    await page.goto(path);
    expect(await overflow(), path).toBeLessThanOrEqual(0);
  }
});
