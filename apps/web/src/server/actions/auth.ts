'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNext, siteUrl } from '@/lib/auth/config';
import { supabaseServer } from '@/lib/auth/supabase-server';
import { ensureCurrentAccount } from '@/server/session';

export interface AuthState {
  error?: string;
  info?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Escribe un correo válido').max(320),
  password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(128),
});

const BLOCKED_MESSAGE = 'Esta cuenta no está activa. Escribe a soporte si crees que es un error.';

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Confirma tu correo: te enviamos un enlace al registrarte.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ese correo ya tiene cuenta. Inicia sesión.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if (m.includes('weak') || m.includes('password should')) return 'La contraseña es demasiado débil. Usa una más larga y variada.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: 'El inicio de sesión aún no está configurado.' };
  const parsed = credentials.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: friendly(error.message) };
  const result = await ensureCurrentAccount();
  if (result !== 'ok') {
    await supabase.auth.signOut();
    return { error: result === 'blocked' ? BLOCKED_MESSAGE : 'No se pudo verificar la sesión. Inténtalo de nuevo.' };
  }
  redirect(safeNext(String(form.get('next') ?? '')));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await supabaseServer();
  const site = siteUrl();
  if (!supabase || !site) return { error: 'El registro aún no está configurado.' };
  const parsed = credentials
    .extend({ name: z.string().trim().min(2, 'Escribe tu nombre').max(120) })
    .safeParse({ email: form.get('email'), password: form.get('password'), name: form.get('name') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
      emailRedirectTo: `${site}/auth/callback`,
    },
  });
  if (error) return { error: friendly(error.message) };

  // Si el proyecto exige confirmar el correo, no hay sesión todavía.
  if (!data.session) {
    return { info: 'Te enviamos un correo de confirmación. Abre el enlace para activar tu cuenta.' };
  }
  const result = await ensureCurrentAccount();
  if (result !== 'ok') {
    await supabase.auth.signOut();
    return { error: result === 'blocked' ? BLOCKED_MESSAGE : 'No se pudo crear la cuenta. Inténtalo de nuevo.' };
  }
  redirect('/app');
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase?.auth.signOut();
  redirect('/login');
}
