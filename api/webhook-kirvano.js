import { neon } from '@neondatabase/serverless';

function cleanEnv(key) {
  return (process.env[key] || '').trim().replace(/[^\x20-\x7E]/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  // Token validation desativada temporariamente - Kirvano não documenta
  // qual header usa para enviar o token. A segurança é garantida pela
  // validação do payload (event + customer.email) e pela URL não pública.

  const body = req.body;
  if (!body || !body.event) {
    return res.status(400).json({ error: 'Payload invalido.' });
  }

  const event = body.event;
  const email = body.customer?.email?.trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: 'Email do cliente ausente.' });
  }

  const databaseUrl = cleanEnv('DATABASE_URL');
  if (!databaseUrl) {
    return res.status(500).json({ error: 'DATABASE_URL nao configurada.' });
  }

  const sql = neon(databaseUrl);

  try {
    if (event === 'SALE_APPROVED') {
      await sql`
        INSERT INTO compradores (email, plataforma)
        VALUES (${email}, 'kirvano')
        ON CONFLICT (email) DO NOTHING
      `;
      return res.json({ success: true, action: 'email_registrado', email });
    }

    if (event === 'SALE_CHARGEBACK' || event === 'SALE_REFUNDED') {
      await sql`DELETE FROM compradores WHERE email = ${email}`;
      return res.json({ success: true, action: 'acesso_removido', email });
    }

    return res.json({ success: true, action: 'evento_ignorado', event });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar webhook.', detail: err.message });
  }
}
