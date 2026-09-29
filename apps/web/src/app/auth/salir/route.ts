import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/auth/supabase-server';

// Cierra la sesión de una cuenta que no puede usar la plataforma (suspendida o dada de
// baja) y vuelve al login con el aviso correspondiente. No acepta destinos externos.
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase?.auth.signOut();
  const login = new URL('/login', request.nextUrl);
  if (request.nextUrl.searchParams.get('motivo') === 'cuenta') login.searchParams.set('error', 'cuenta');
  return NextResponse.redirect(login);
}
