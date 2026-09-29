import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth/config';
import { supabaseServer } from '@/lib/auth/supabase-server';
import { ensureCurrentAccount } from '@/server/session';

// Destino del enlace de confirmación de correo (flujo PKCE de Supabase Auth).
//
// Solo se acepta `code`: su canje exige el verificador PKCE guardado en una cookie de
// ESTE navegador al registrarse, así que un enlace ajeno no puede iniciar sesión aquí
// con la cuenta de otra persona. El flujo `token_hash` no tiene esa protección
// (permitiría "forzar" una sesión ajena) y no se usa en V1.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get('next'));
  const supabase = await supabaseServer();
  if (!supabase) return NextResponse.redirect(new URL('/login', url));

  const code = url.searchParams.get('code');
  const ok = code ? !(await supabase.auth.exchangeCodeForSession(code)).error : false;

  if (ok) {
    const result = await ensureCurrentAccount();
    if (result === 'ok') return NextResponse.redirect(new URL(next, url));
    await supabase.auth.signOut();
    if (result === 'blocked') return NextResponse.redirect(new URL('/login?error=cuenta', url));
  }
  const fail = new URL('/login', url);
  fail.searchParams.set('error', 'enlace');
  return NextResponse.redirect(fail);
}
