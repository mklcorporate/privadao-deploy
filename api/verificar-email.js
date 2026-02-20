import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// ---------------------------------------------------------------------------
// Cakto: OAuth2 token + consulta de pedidos por email
// ---------------------------------------------------------------------------
async function getCaktoToken() {
  const clientId = process.env.CAKTO_CLIENT_ID;
  const clientSecret = process.env.CAKTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://api.cakto.com.br/public_api/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

async function checkCakto(email) {
  try {
    const token = await getCaktoToken();
    if (!token) return false;

    const res = await fetch(
      `https://api.cakto.com.br/public_api/orders/?customer=${encodeURIComponent(email)}&status=paid&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );

    if (!res.ok) return false;
    const data = await res.json();
    return (data.count && data.count > 0) || (Array.isArray(data.results) && data.results.length > 0);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PerfectPay: consulta de vendas aprovadas (2=Aprovado, 10=Completo)
// ---------------------------------------------------------------------------
async function checkPerfectPay(email) {
  try {
    const ppToken = process.env.PERFECTPAY_TOKEN;
    if (!ppToken) return false;

    const targetEmail = email.toLowerCase();
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

      if (!res.ok) return false;
      const data = await res.json();
      const sales = data.sales?.data || [];
      if (sales.length === 0) break;

      for (const sale of sales) {
        const customers = sale.customer || [];
        for (const c of customers) {
          if (c.email && c.email.toLowerCase() === targetEmail) return true;
        }
      }

      if (page >= (data.sales?.total_pages || 1)) break;
      page++;
    }
    return false;
  } catch {
    return false;
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
    const [cakto, perfectpay] = await Promise.all([
      checkCakto(cleanEmail),
      checkPerfectPay(cleanEmail),
    ]);

    if (cakto || perfectpay) {
      const token = await new SignJWT({ email: cleanEmail })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .setIssuedAt()
        .sign(JWT_SECRET);

      res.setHeader('Set-Cookie',
        `privadao_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.VERCEL ? '; Secure' : ''}`
      );
      return res.json({ success: true, message: 'Acesso liberado!' });
    }

    return res.status(403).json({
      success: false,
      message: 'Email nao encontrado. Verifique se usou o mesmo email da compra.',
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar. Tente novamente em instantes.',
    });
  }
}
