import 'server-only';
import { withTenant, type Tx } from '@lombana/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { supabaseServer } from '@/lib/auth/supabase-server';
import { db } from './db';

export const ORG_COOKIE = 'lombana_org';
const PROVIDER = 'supabase';

export interface OrgSummary {
  id: string;
  name: string;
  kind: 'personal' | 'team' | 'business';
  role: string;
}

export interface Account {
  userId: string;
  email: string;
  displayName: string | null;
  orgs: OrgSummary[];
  org: OrgSummary;
  /** Moderador de plataforma (rol ADMIN/SUPER_ADMIN con admin.moderate). */
  isModerator: boolean;
  /** Permisos de plataforma (admin.*) del usuario. */
  platformPermissions: string[];
}

interface VerifiedIdentity {
  subject: string;
  email: string;
  name: string | null;
}

/** Identidad verificada por el proveedor (firma del token), o null. */
async function verifiedIdentity(): Promise<VerifiedIdentity | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || typeof claims.email !== 'string') return null;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
  return { subject: claims.sub, email: claims.email, name };
}

/** Error de PostgreSQL para cuentas suspendidas o dadas de baja (ver app.ensure_account). */
const ACCOUNT_BLOCKED = '42501';

function isBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === ACCOUNT_BLOCKED;
}

/**
 * Alta o actualización de la cuenta. Se llama al iniciar sesión, no en cada petición.
 * Devuelve null si la cuenta existe pero está suspendida o dada de baja.
 */
export async function ensureAccount(identity: VerifiedIdentity): Promise<string | null> {
  try {
    const { rows } = await db().query<{ user_id: string }>(
      'select user_id from app.ensure_account($1, $2, $3, $4)',
      [PROVIDER, identity.subject, identity.email, identity.name],
    );
    return rows[0]!.user_id;
  } catch (error) {
    if (isBlocked(error)) return null;
    throw error;
  }
}

export type EnsureResult = 'ok' | 'blocked' | 'no-session';

export async function ensureCurrentAccount(): Promise<EnsureResult> {
  const identity = await verifiedIdentity();
  if (!identity) return 'no-session';
  return (await ensureAccount(identity)) ? 'ok' : 'blocked';
}

type AccountState = { status: 'anonymous' } | { status: 'blocked' } | { status: 'ok'; account: Account };

/**
 * Estado de la cuenta de la petición actual (memoizado por petición). Sin escrituras
 * salvo el primer acceso de una identidad que aún no tiene cuenta.
 */
const accountState = cache(async (): Promise<AccountState> => {
  const identity = await verifiedIdentity();
  if (!identity) return { status: 'anonymous' };

  const resolved = await db().query<{ id: string | null }>('select app.resolve_account($1, $2) as id', [
    PROVIDER,
    identity.subject,
  ]);
  const userId = resolved.rows[0]?.id ?? (await ensureAccount(identity));
  if (!userId) return { status: 'blocked' };

  const { orgs, displayName, isModerator, platformPermissions } = await withTenant(db(), { userId, orgId: null }, async (tx) => {
    const o = await tx.query<OrgSummary>(
      `select o.id, o.name, o.kind, m.role_code as role
         from public.memberships m
         join public.organizations o on o.id = m.org_id
        where m.user_id = $1 and m.status = 'active' and o.deleted_at is null
        order by (o.kind = 'personal') desc, o.created_at`,
      [userId],
    );
    const u = await tx.query<{ display_name: string | null; perms: string[] }>(
      'select display_name, app.my_platform_permissions() as perms from public.users where id = $1',
      [userId],
    );
    const perms = u.rows[0]?.perms ?? [];
    return {
      orgs: o.rows,
      displayName: u.rows[0]?.display_name ?? null,
      isModerator: perms.includes('admin.moderate'),
      platformPermissions: perms,
    };
  });
  if (orgs.length === 0) return { status: 'blocked' };

  const store = await cookies();
  const wanted = store.get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0]!;
  return { status: 'ok', account: { userId, email: identity.email, displayName, orgs, org, isModerator, platformPermissions } };
});

/** Cuenta activa de la petición actual, o null (sin sesión, suspendida o dada de baja). */
export async function getAccount(): Promise<Account | null> {
  const state = await accountState();
  return state.status === 'ok' ? state.account : null;
}

/** Para páginas y acciones protegidas: cuenta obligatoria o redirección a /login. */
export async function requireAccount(): Promise<Account> {
  const state = await accountState();
  if (state.status === 'ok') return state.account;
  // Con sesión válida pero cuenta bloqueada: se cierra la sesión (en una ruta, que sí
  // puede borrar cookies) para no quedar en un ciclo entre /app y /login.
  redirect(state.status === 'blocked' ? '/auth/salir?motivo=cuenta' : '/login');
}

/** Ejecuta `fn` con el contexto de la cuenta y organización activas (RLS aplicado). */
export async function inOrg<T>(fn: (tx: Tx, account: Account) => Promise<T>): Promise<T> {
  const account = await requireAccount();
  return withTenant(db(), { userId: account.userId, orgId: account.org.id }, (tx) => fn(tx, account));
}
