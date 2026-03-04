import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SignJWT, jwtVerify } from 'jose';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

function cleanEnv(key) {
  return (process.env[key] || '').trim().replace(/[^\x20-\x7E]/g, '');
}

const JWT_SECRET = new TextEncoder().encode(cleanEnv('JWT_SECRET'));

// ---------------------------------------------------------------------------
// Middlewares globais
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Auth middleware para /obrigado
// ---------------------------------------------------------------------------
async function authGuard(req, res, next) {
  const token = req.cookies?.privadao_session;

  if (!token) {
    return res.redirect('/?login=1');
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('privadao_session', { path: '/' });
    res.redirect('/?login=1');
  }
}

// ---------------------------------------------------------------------------
// Cakto
// ---------------------------------------------------------------------------
async function getCaktoToken() {
  const clientId = cleanEnv('CAKTO_CLIENT_ID');
  const clientSecret = cleanEnv('CAKTO_CLIENT_SECRET');
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
  if (!tokenRes.token) return { found: false, tokenError: tokenRes.error };

  try {
    const res = await fetch(
      `https://api.cakto.com.br/public_api/orders/?customer=${encodeURIComponent(email)}&status=paid&limit=1`,
      { headers: { Authorization: `Bearer ${tokenRes.token}`, Accept: 'application/json' } },
    );

    if (!res.ok) return { found: false, ordersError: `status_${res.status}` };

    const data = await res.json();
    const found = (data.count > 0) || (Array.isArray(data.results) && data.results.length > 0);
    return { found, count: data.count };
  } catch (err) {
    return { found: false, error: 'orders_fetch', message: err.message };
  }
}

// ---------------------------------------------------------------------------
// PerfectPay
// ---------------------------------------------------------------------------
async function checkPerfectPay(email) {
  const ppToken = cleanEnv('PERFECTPAY_TOKEN');
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
          sale_status: [1, 2, 3, 7, 8, 10],
          page,
          start_date_sale: '2020-01-01',
          end_date_sale: '2030-12-31',
        }),
      });

      if (!res.ok) return { found: false, error: `status_${res.status}` };

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
// Kirvano / banco Neon (compradores gravados via webhook)
// ---------------------------------------------------------------------------
function getDb() {
  const databaseUrl = cleanEnv('DATABASE_URL');
  if (!databaseUrl) return null;
  return neon(databaseUrl);
}

async function checkDatabase(email) {
  const sql = getDb();
  if (!sql) return { found: false, error: 'DATABASE_URL vazia' };

  try {
    const rows = await sql`SELECT 1 FROM compradores WHERE email = ${email} LIMIT 1`;
    return { found: rows.length > 0 };
  } catch (err) {
    return { found: false, error: 'db_error', message: err.message };
  }
}

// ---------------------------------------------------------------------------
// Rota: POST /api/verificar-email
// ---------------------------------------------------------------------------
app.post('/api/verificar-email', async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, message: 'Email obrigatorio.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'Email invalido.' });
  }

  try {
    const [caktoResult, ppResult, dbResult] = await Promise.all([
      checkCakto(cleanEmail),
      checkPerfectPay(cleanEmail),
      checkDatabase(cleanEmail),
    ]);

    const verified = caktoResult.found || ppResult.found || dbResult.found;

    if (verified) {
      const token = await new SignJWT({ email: cleanEmail })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .setIssuedAt()
        .sign(JWT_SECRET);

      const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.cookie('privadao_session', token, {
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 86400 * 1000,
        secure: isSecure,
        path: '/',
      });

      return res.json({ success: true, message: 'Acesso liberado!' });
    }

    console.log('[VERIFICAR]', cleanEmail, JSON.stringify({ cakto: caktoResult, pp: ppResult, db: dbResult }));

    return res.status(403).json({
      success: false,
      message: 'Email nao encontrado. Verifique se usou o mesmo email da compra.',
    });
  } catch (err) {
    console.error('[VERIFICAR] Erro:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro interno. Tente novamente.',
    });
  }
});

// ---------------------------------------------------------------------------
// Rota: GET /api/diagnostico (temporario - remover em producao)
// ---------------------------------------------------------------------------
app.get('/api/diagnostico', async (req, res) => {
  const results = {};

  try {
    const tokenRes = await getCaktoToken();
    results.cakto = tokenRes.token ? 'OK - token obtido' : `ERRO - ${tokenRes.error}`;
  } catch (e) {
    results.cakto = `ERRO - ${e.message}`;
  }

  try {
    const ppToken = cleanEnv('PERFECTPAY_TOKEN');
    if (!ppToken) {
      results.perfectpay = 'ERRO - token vazio';
    } else {
      const ppRes = await fetch('https://app.perfectpay.com.br/api/v1/sales/get', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${ppToken}` },
        body: JSON.stringify({ sale_status: [1, 2, 3, 7, 8, 10], page: 1, start_date_sale: '2020-01-01', end_date_sale: '2030-12-31' }),
      });
      if (ppRes.ok) {
        const data = await ppRes.json();
        results.perfectpay = `OK - ${data.sales?.total || 0} vendas, ${data.sales?.total_pages || 0} paginas`;
      } else {
        results.perfectpay = `ERRO - HTTP ${ppRes.status}`;
      }
    }
  } catch (e) {
    results.perfectpay = `ERRO - ${e.message}`;
  }

  try {
    const sql = getDb();
    if (!sql) {
      results.database = 'ERRO - DATABASE_URL vazia';
    } else {
      const rows = await sql`SELECT COUNT(*) as total FROM compradores`;
      results.database = `OK - ${rows[0]?.total || 0} compradores`;
    }
  } catch (e) {
    results.database = `ERRO - ${e.message}`;
  }

  results.env_check = {
    JWT_SECRET: cleanEnv('JWT_SECRET') ? 'definido' : 'VAZIO',
    PERFECTPAY_TOKEN: cleanEnv('PERFECTPAY_TOKEN') ? 'definido' : 'VAZIO',
    CAKTO_CLIENT_ID: cleanEnv('CAKTO_CLIENT_ID') ? 'definido' : 'VAZIO',
    CAKTO_CLIENT_SECRET: cleanEnv('CAKTO_CLIENT_SECRET') ? 'definido' : 'VAZIO',
    DATABASE_URL: cleanEnv('DATABASE_URL') ? 'definido' : 'VAZIO',
    MANGOFY_API_KEY: cleanEnv('MANGOFY_API_KEY') ? 'definido' : 'VAZIO',
    MANGOFY_STORE_CODE: cleanEnv('MANGOFY_STORE_CODE') ? 'definido' : 'VAZIO',
  };

  return res.json(results);
});

// ---------------------------------------------------------------------------
// Rota: POST /api/diagnostico-email (temporario)
// ---------------------------------------------------------------------------
app.post('/api/diagnostico-email', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Informe o email' });

  const cleanEmail = email.trim().toLowerCase();

  const [caktoResult, ppResult, dbResult] = await Promise.all([
    checkCakto(cleanEmail).catch(e => ({ found: false, error: e.message })),
    checkPerfectPay(cleanEmail).catch(e => ({ found: false, error: e.message })),
    checkDatabase(cleanEmail).catch(e => ({ found: false, error: e.message })),
  ]);

  return res.json({
    email: cleanEmail,
    cakto: caktoResult,
    perfectpay: ppResult,
    database: dbResult,
    resultado: caktoResult.found || ppResult.found || dbResult.found ? 'ACESSO LIBERADO' : 'NAO ENCONTRADO',
  });
});

// ---------------------------------------------------------------------------
// Rota: POST /api/webhook-kirvano
// Responde 200 imediatamente e processa em background
// ---------------------------------------------------------------------------
app.post('/api/webhook-kirvano', (req, res) => {
  const body = req.body;
  res.status(200).json({ received: true });

  if (!body || !body.event) return;

  processKirvano(body).catch(err => {
    console.error('[kirvano-webhook] Erro no processamento async:', err.message);
  });
});

async function processKirvano(body) {
  const event = body.event;
  const email = body.customer?.email?.trim().toLowerCase();

  if (!email) {
    console.log('[kirvano-webhook] Email ausente no payload. Evento:', event);
    return;
  }

  const sql = getDb();
  if (!sql) {
    console.error('[kirvano-webhook] DATABASE_URL nao configurada.');
    return;
  }

  try {
    if (event === 'SALE_APPROVED') {
      await sql`
        INSERT INTO compradores (email, plataforma)
        VALUES (${email}, 'kirvano')
        ON CONFLICT (email) DO NOTHING
      `;
      console.log('[kirvano-webhook] Email registrado:', email);
    } else if (event === 'SALE_CHARGEBACK' || event === 'SALE_REFUNDED') {
      await sql`DELETE FROM compradores WHERE email = ${email}`;
      console.log('[kirvano-webhook] Acesso removido:', email);
    } else {
      console.log('[kirvano-webhook] Evento ignorado:', event, 'Email:', email);
    }
  } catch (err) {
    console.error('[kirvano-webhook] Erro DB:', err.message, 'Email:', email);
  }
}

// ---------------------------------------------------------------------------
// Rota: POST /api/webhook-mangofy
// Responde 200 imediatamente e processa em background para evitar timeout
// ---------------------------------------------------------------------------
app.post('/api/webhook-mangofy', (req, res) => {
  const body = req.body;
  if (!body) {
    return res.status(200).json({ received: true });
  }

  res.status(200).json({ received: true });

  processMangofy(body).catch(err => {
    console.error('[mangofy-webhook] Erro no processamento async:', err.message);
  });
});

async function processMangofy(body) {
  const sql = getDb();
  if (!sql) {
    console.error('[mangofy-webhook] DATABASE_URL nao configurada.');
    return;
  }

  try {
    await sql`INSERT INTO webhook_logs (plataforma, payload) VALUES ('mangofy', ${JSON.stringify(body)})`;
  } catch (err) {
    console.error('[mangofy-webhook] Erro ao logar payload:', err.message);
  }

  const paymentCode = body.payment_code || body.code || '';
  const status = body.payment_status || body.status || '';

  let email = (
    body.customer?.email ||
    body.email ||
    body.buyer?.email ||
    body.client?.email ||
    body.contact_email ||
    body.customerEmail
  )?.trim().toLowerCase() || null;

  if (!email && paymentCode) {
    const apiKey = cleanEnv('MANGOFY_API_KEY');
    const storeCode = cleanEnv('MANGOFY_STORE_CODE');

    if (apiKey && storeCode) {
      try {
        const payRes = await fetch(`https://checkout.mangofy.com.br/api/v1/payment/${paymentCode}`, {
          headers: { Authorization: apiKey, 'Store-Code': storeCode, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (payRes.ok) {
          const payData = await payRes.json();
          email = (payData.customer?.email || payData.email)?.trim().toLowerCase() || null;
        }
      } catch (err) {
        console.error('[mangofy-webhook] Erro ao buscar email via API:', err.message);
      }
    }
  }

  if (!email) {
    console.log('[mangofy-webhook] Sem email no payload. Status:', status, 'Code:', paymentCode);
    return;
  }

  try {
    if (status === 'approved') {
      await sql`
        INSERT INTO compradores (email, plataforma)
        VALUES (${email}, 'mangofy')
        ON CONFLICT (email) DO NOTHING
      `;
      console.log('[mangofy-webhook] Email registrado:', email);
    } else if (status === 'refunded') {
      await sql`DELETE FROM compradores WHERE email = ${email}`;
      console.log('[mangofy-webhook] Acesso removido:', email);
    } else {
      console.log('[mangofy-webhook] Evento ignorado. Status:', status, 'Email:', email);
    }
  } catch (err) {
    console.error('[mangofy-webhook] Erro DB:', err.message, 'Email:', email);
  }
}

// ---------------------------------------------------------------------------
// Rota: GET /api/logout
// ---------------------------------------------------------------------------
app.get('/api/logout', (req, res) => {
  res.clearCookie('privadao_session', { path: '/' });
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Arquivos protegidos: /obrigado
// ---------------------------------------------------------------------------
app.use('/obrigado', authGuard, express.static(join(__dirname, 'obrigado')));

// ---------------------------------------------------------------------------
// Arquivos estaticos publicos
// ---------------------------------------------------------------------------
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html'],
}));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Privadao rodando na porta ${PORT}`);
});
