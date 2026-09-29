import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authConfig, SESSION_COOKIE_OPTIONS } from '@/lib/auth/config';

// Proxy (antes "middleware"): refresca la sesión en cada petición y protege /app.
// La verificación real de identidad (firma del token) la hace getClaims().
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const cfg = authConfig();
  const isApp = request.nextUrl.pathname.startsWith('/app');

  if (!cfg) {
    if (isApp) return NextResponse.redirect(new URL('/login', request.url));
    return response;
  }

  const supabase = createServerClient(cfg.url, cfg.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (isApp && !data?.claims) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // Todo menos estáticos, imágenes y la API de salud.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/v1/health).*)'],
};
