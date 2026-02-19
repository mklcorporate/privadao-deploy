import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export default async function middleware(request) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/obrigado')) {
    return;
  }

  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/privadao_session=([^;]+)/);
  const token = match ? match[1] : null;

  if (!token) {
    return Response.redirect(new URL('/?login=1', request.url), 302);
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return;
  } catch {
    const res = Response.redirect(new URL('/?login=1', request.url), 302);
    res.headers.set('Set-Cookie', 'privadao_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res;
  }
}

export const config = {
  matcher: ['/obrigado', '/obrigado/', '/obrigado/index.html'],
};
