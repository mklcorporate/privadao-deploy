import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode((process.env.JWT_SECRET || '').trim());

// ---------------------------------------------------------------------------
// Cakto: OAuth2 token + consulta de pedidos por email
// ---------------------------------------------------------------------------
async function getCaktoToken() {
  const clientId = (process.env.CAKTO_CLIENT_ID || '').trim();
  const clientSecret = (process.env.CAKTO_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return { token: null, error: 'vars_vazias' };

  try {
    const res = await fetch('https://api.cakto.com.br/public_api/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
    });

    if (!res.ok) {
      const body = await res.text();
      return { token: null, error: `oauth_${res.status}`, body };
    }

    const data = await res.json();
    return { token: data.access_token || null, error: data.access_token ? null : 'sem_access_token' };
  } catch (err) {
    return { token: null, error: 'fetch_error', message: err.message };
  }
}

async function checkCakto(email) {
  const tokenRes = await getCaktoToken();
  if (!tokenRes.token) return { found: false, tokenError: tokenRes.error, tokenBody: tokenRes.body };

  try {
    const res = await fetch(
      `https://api.cakto.com.br/public_api/orders/?customer=${encodeURIComponent(email)}&status=paid&limit=1`,
      { headers: { Authorization: `Bearer ${tokenRes.token}`, Accept: 'application/json' } },
    );

    if (!res.ok) {
      const body = await res.text();
      return { found: false, ordersError: `status_${res.status}`, body };
    }

    const data = await res.json();
    const found = (data.count > 0) || (Array.isArray(data.results) && data.results.length > 0);
    return { found, count: data.count };
  } catch (err) {
    return { found: false, error: 'orders_fetch', message: err.message };
  }
}

// ---------------------------------------------------------------------------
// PerfectPay: consulta de vendas aprovadas
// ---------------------------------------------------------------------------
async function checkPerfectPay(email) {
  const ppToken = (process.env.PERFECTPAY_TOKEN || '').trim();
  if (!ppToken) return { found: false, error: 'token_vazio' };

  const targetEmail = email.toLowerCase();

  try {
    let page = 1;
    while (page <= 50) {
      const res = await fetch('https://app.perfectpay.com.br/api/v1/sales/get', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ppToken}`,
        },
        body: JSON.stringify({
          sale_status: [2, 10],
          page,
          start_date_sale: '2020-01-01',
          end_date_sale: '2030-12-31',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { found: false, error: `status_${res.status}`, body };
      }

      const data = await res.json();
      const sales = data.sales?.data || [];
      if (sales.length === 0) break;

      for (const sale of sales) {
        for (const c of (sale.customer || [])) {
          if (c.email && c.email.toLowerCase() === targetEmail) return { found: true };
        }
      }

      if (page >= (data.sales?.total_pages || 1)) break;
      page++;
    }
    return { found: false, pagesChecked: page };
  } catch (err) {
    return { found: false, error: 'fetch_error', message: err.message };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Metodo nao permitido.' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, message: 'Email obrigatorio.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'Email invalido.' });
  }

  try {
    const [caktoResult, ppResult] = await Promise.all([
      checkCakto(cleanEmail),
      checkPerfectPay(cleanEmail),
    ]);

    const verified = caktoResult.found || ppResult.found;

    if (verified) {
      const token = await new SignJWT({ email: cleanEmail })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .setIssuedAt()
        .sign(JWT_SECRET);

      res.setHeader('Set-Cookie',
        `privadao_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.VERCEL ? '; Secure' : ''}`,
      );
      return res.json({ success: true, message: 'Acesso liberado!' });
    }

    return res.status(403).json({
      success: false,
      message: 'Email nao encontrado. Verifique se usou o mesmo email da compra.',
      _debug: { cakto: caktoResult, perfectpay: ppResult },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Erro interno. Tente novamente.',
      _debug: { error: err.message },
    });
  }
}
