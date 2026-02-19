import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const PERFECTPAY_TOKEN = process.env.PERFECTPAY_TOKEN;
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID;
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET;

// ---------------------------------------------------------------------------
// Cakto: OAuth2 token + consulta de pedidos
// ---------------------------------------------------------------------------
let caktoToken = null;
let caktoTokenExpiry = 0;

async function getCaktoToken() {
  if (caktoToken && Date.now() < caktoTokenExpiry) {
    return caktoToken;
  }

  if (!CAKTO_CLIENT_ID || !CAKTO_CLIENT_SECRET) {
    console.error('Cakto: VARIAVEIS DE AMBIENTE AUSENTES', {
      CAKTO_CLIENT_ID: CAKTO_CLIENT_ID ? `${CAKTO_CLIENT_ID.substring(0, 8)}...` : 'VAZIO',
      CAKTO_CLIENT_SECRET: CAKTO_CLIENT_SECRET ? 'definido' : 'VAZIO',
    });
    return null;
  }

  console.error('Cakto: obtendo token...');

  const params = new URLSearchParams();
  params.append('client_id', CAKTO_CLIENT_ID);
  params.append('client_secret', CAKTO_CLIENT_SECRET);

  const res = await fetch('https://api.cakto.com.br/public_api/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Cakto OAuth falhou:', res.status, body);
    return null;
  }

  const data = await res.json();
  caktoToken = data.access_token;
  caktoTokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 3600000);
  console.error('Cakto: token obtido com sucesso');
  return caktoToken;
}

async function checkCakto(email) {
  try {
    const token = await getCaktoToken();
    if (!token) {
      console.error('Cakto: sem token, abortando');
      return false;
    }

    const url = new URL('https://api.cakto.com.br/public_api/orders/');
    url.searchParams.set('customer', email);
    url.searchParams.set('status', 'paid');
    url.searchParams.set('limit', '1');

    console.error('Cakto: buscando orders para', email);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Cakto orders falhou:', res.status, body);
      return false;
    }

    const data = await res.json();
    console.error('Cakto: count=', data.count, 'results=', data.results?.length);
    return data.count > 0 || (data.results && data.results.length > 0);
  } catch (err) {
    console.error('Erro Cakto:', err.message, err.stack);
    return false;
  }
}

// ---------------------------------------------------------------------------
// PerfectPay: consulta de vendas aprovadas (status 2=Aprovado, 10=Completo)
// ---------------------------------------------------------------------------
async function checkPerfectPay(email) {
  try {
    const targetEmail = email.toLowerCase();
    let page = 1;
    const maxPages = 50;

    while (page <= maxPages) {
      const res = await fetch('https://app.perfectpay.com.br/api/v1/sales/get', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PERFECTPAY_TOKEN}`,
        },
        body: JSON.stringify({
          sale_status: [2, 10],
          page,
          start_date_sale: '2020-01-01',
          end_date_sale: '2030-12-31',
        }),
      });

      if (!res.ok) {
        console.error('PerfectPay falhou:', res.status);
        return false;
      }

      const data = await res.json();
      const sales = data.sales?.data || [];

      if (sales.length === 0) break;

      for (const sale of sales) {
        const customers = sale.customer || [];
        for (const c of customers) {
          if (c.email && c.email.toLowerCase() === targetEmail) {
            return true;
          }
        }
      }

      const totalPages = data.sales?.total_pages || 1;
      if (page >= totalPages) break;
      page++;
    }

    return false;
  } catch (err) {
    console.error('Erro PerfectPay:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handler da Vercel Serverless Function
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
    const debugInfo = {
      envVars: {
        JWT_SECRET: !!process.env.JWT_SECRET,
        PERFECTPAY_TOKEN: !!process.env.PERFECTPAY_TOKEN,
        CAKTO_CLIENT_ID: !!process.env.CAKTO_CLIENT_ID,
        CAKTO_CLIENT_SECRET: !!process.env.CAKTO_CLIENT_SECRET,
      },
    };

    const [cakto, perfectpay] = await Promise.all([
      checkCakto(cleanEmail),
      checkPerfectPay(cleanEmail),
    ]);

    debugInfo.caktoResult = cakto;
    debugInfo.perfectpayResult = perfectpay;

    const verified = cakto || perfectpay;

    if (verified) {
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
      debug: debugInfo,
    });
  } catch (err) {
    console.error('Erro na verificacao:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar. Tente novamente em instantes.',
    });
  }
}
