import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closePools, createOrgAs, createUser, PG, pgError } from './helpers.js';

// Escenario: Ana es dueña de org1; Beto es dueño de org2; Carla es miembro simple de org1.
let ana: string, beto: string, carla: string;
let org1: string, org2: string;
let project1: string, project2: string;

beforeAll(async () => {
  ana = await createUser('ana');
  beto = await createUser('beto');
  carla = await createUser('carla');
  org1 = await createOrgAs(ana, 'org-uno');
  org2 = await createOrgAs(beto, 'org-dos');
  await admin.query(
    `insert into public.memberships (org_id, user_id, role_code) values ($1, $2, 'ORG_MEMBER')`,
    [org1, carla],
  );
  project1 = await as(ana, org1, async (tx) =>
    (await tx.query(`insert into public.projects (org_id, owner_id, name) values ($1, $2, 'Proyecto de Ana') returning id`,
      [org1, ana])).rows[0].id);
  project2 = await as(beto, org2, async (tx) =>
    (await tx.query(`insert into public.projects (org_id, owner_id, name) values ($1, $2, 'Proyecto de Beto') returning id`,
      [org2, beto])).rows[0].id);
});

afterAll(closePools);

describe('aislamiento entre organizaciones', () => {
  it('cada usuario ve solo los proyectos de su organización activa', async () => {
    const anaSees = await as(ana, org1, async (tx) => (await tx.query('select id from public.projects')).rows);
    const betoSees = await as(beto, org2, async (tx) => (await tx.query('select id from public.projects')).rows);
    expect(anaSees.map((r) => r.id)).toEqual([project1]);
    expect(betoSees.map((r) => r.id)).toEqual([project2]);
  });

  it('un usuario no puede leer datos de otra organización aunque fije ese contexto', async () => {
    const rows = await as(beto, org1, async (tx) => (await tx.query('select id from public.projects')).rows);
    expect(rows).toEqual([]);
  });

  it('sin contexto no se ve nada', async () => {
    const rows = await as(ana, null, async (tx) => (await tx.query('select id from public.projects')).rows);
    expect(rows).toEqual([]);
  });

  it('no se puede insertar en otra organización', async () => {
    const code = await pgError(as(beto, org2, (tx) =>
      tx.query(`insert into public.projects (org_id, owner_id, name) values ($1, $2, 'intruso')`, [org1, beto])));
    expect(code).toBe(PG.RLS);
  });

  it('no se puede modificar datos de otra organización (0 filas) ni borrar proyectos desde la app', async () => {
    const updated = await as(beto, org2, (tx) =>
      tx.query(`update public.projects set name = 'hackeado' where id = $1`, [project1]));
    expect(updated.rowCount).toBe(0);
    // La app ya no tiene DELETE sobre proyectos (borrado lógico con deleted_at).
    expect(await pgError(as(beto, org2, (tx) => tx.query(`delete from public.projects where id = $1`, [project1]))))
      .toBe(PG.RLS);
    const { rows } = await admin.query('select name from public.projects where id = $1', [project1]);
    expect(rows[0].name).toBe('Proyecto de Ana');
  });

  it('no se puede mover una fila propia a otra organización', async () => {
    const code = await pgError(as(ana, org1, (tx) =>
      tx.query(`update public.projects set org_id = $1 where id = $2`, [org2, project1])));
    expect(code).toBe(PG.RLS);
  });

  it('una tarea no puede apuntar a un proyecto de otra organización (FK compuesta)', async () => {
    const code = await pgError(as(ana, org1, (tx) =>
      tx.query(`insert into public.project_tasks (org_id, project_id, position, title) values ($1, $2, 0, 'x')`,
        [org1, project2])));
    expect(code).toBe(PG.FK);
  });

  it('un miembro ve el proyecto de su organización', async () => {
    const rows = await as(carla, org1, async (tx) => (await tx.query('select id from public.projects')).rows);
    expect(rows.map((r) => r.id)).toEqual([project1]);
  });

  it('la vista de progreso no filtra proyectos ajenos', async () => {
    const rows = await as(beto, org2, async (tx) => (await tx.query('select project_id from public.project_progress')).rows);
    expect(rows.map((r) => r.project_id)).toEqual([project2]);
  });

  it('un usuario solo ve usuarios con quienes comparte la organización activa', async () => {
    const anaSees = await as(ana, org1, async (tx) => (await tx.query('select id from public.users order by id')).rows);
    expect(anaSees.map((r) => r.id).sort()).toEqual([ana, carla].sort());
    const betoSees = await as(beto, org2, async (tx) => (await tx.query('select id from public.users')).rows);
    expect(betoSees.map((r) => r.id)).toEqual([beto]);
  });

  it('las organizaciones de otros no se listan', async () => {
    const rows = await as(beto, org2, async (tx) => (await tx.query('select id from public.organizations')).rows);
    expect(rows.map((r) => r.id)).toEqual([org2]);
  });

  it('el índice de búsqueda muestra catálogo curado a todos y contenido privado solo a su organización', async () => {
    await admin.query(
      `insert into public.search_documents (org_id, source_type, source_key, title, curated_source_url, curated_checked_at)
       values (null, 'curated_resource', 'guia-x', 'Guía pública', 'https://example.org/guia', now())`);
    await as(ana, org1, (tx) => tx.query(
      `insert into public.search_documents (org_id, source_type, source_id, title) values ($1, 'project', $2, 'privado de Ana')`,
      [org1, project1]));
    const betoSees = await as(beto, org2, async (tx) => (await tx.query('select title from public.search_documents')).rows);
    expect(betoSees.map((r) => r.title)).toEqual(['Guía pública']);
  });

  it('las conversaciones con CLAU son privadas incluso dentro de la organización', async () => {
    const conv = await as(ana, org1, async (tx) =>
      (await tx.query(`insert into public.ai_conversations (org_id, user_id, title) values ($1, $2, 'mía') returning id`,
        [org1, ana])).rows[0].id);
    const carlaSees = await as(carla, org1, async (tx) => (await tx.query('select id from public.ai_conversations')).rows);
    expect(carlaSees).toEqual([]);
    const code = await pgError(as(carla, org1, (tx) =>
      tx.query(`insert into public.ai_messages (org_id, conversation_id, role, content) values ($1, $2, 'user', '{}')`,
        [org1, conv])));
    expect(code).toBe(PG.RLS);
  });
});

describe('permisos por rol dentro de la organización', () => {
  let leadId: string;

  beforeAll(async () => {
    leadId = (await admin.query(
      `insert into public.leads (org_id, email) values ($1, 'visitante@example.com') returning id`, [org1])).rows[0].id;
  });

  it('el propietario ve los leads; un miembro simple no', async () => {
    const owner = await as(ana, org1, async (tx) => (await tx.query('select id from public.leads')).rows);
    const member = await as(carla, org1, async (tx) => (await tx.query('select id from public.leads')).rows);
    expect(owner.map((r) => r.id)).toEqual([leadId]);
    expect(member).toEqual([]);
  });

  it('otra organización nunca ve los leads, ni siquiera siendo propietaria de la suya', async () => {
    const rows = await as(beto, org2, async (tx) => (await tx.query('select id from public.leads')).rows);
    expect(rows).toEqual([]);
  });

  it('la aplicación no puede insertar leads directamente (solo vía Download Engine)', async () => {
    const code = await pgError(as(ana, org1, (tx) =>
      tx.query(`insert into public.leads (org_id, email) values ($1, 'x@example.com')`, [org1])));
    expect(code).toBe(PG.RLS);
  });

  it('un miembro simple no puede crear productos', async () => {
    const code = await pgError(as(carla, org1, (tx) =>
      tx.query(`insert into public.products (org_id, slug, title, product_type) values ($1, 'p-carla', 'X', 'ebook')`, [org1])));
    expect(code).toBe(PG.RLS);
  });

  it('un miembro simple no puede agregar miembros', async () => {
    const outsider = await createUser('dario');
    const code = await pgError(as(carla, org1, (tx) =>
      tx.query(`insert into public.memberships (org_id, user_id, role_code) values ($1, $2, 'ORG_MEMBER')`, [org1, outsider])));
    expect(code).toBe(PG.RLS);
  });

  it('nadie puede auto-promoverse a propietario en otra organización', async () => {
    const code = await pgError(as(beto, org2, (tx) =>
      tx.query(`insert into public.memberships (org_id, user_id, role_code) values ($1, $2, 'ORG_OWNER')`, [org1, beto])));
    expect(code).toBe(PG.RLS);
  });

  it('crear una organización exige usuario en el contexto', async () => {
    const code = await pgError(as(null as unknown as string, null, (tx) =>
      tx.query(`select app.create_organization('x', 'x-sin-usuario', 'team')`)));
    expect(code).toBe(PG.RLS);
  });

  it('la app no puede crear organizaciones con INSERT directo', async () => {
    const code = await pgError(as(ana, null, (tx) =>
      tx.query(`insert into public.organizations (name, slug, created_by) values ('x', 'directa', $1)`, [ana])));
    expect(code).toBe(PG.RLS);
  });
});
