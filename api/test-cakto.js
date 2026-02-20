export default async function handler(req, res) {
  const clientId = (process.env.CAKTO_CLIENT_ID || '').trim().replace(/[^\x20-\x7E]/g, '');
  const clientSecret = (process.env.CAKTO_CLIENT_SECRET || '').trim().replace(/[^\x20-\x7E]/g, '');

  const info = {
    clientIdLength: clientId.length,
    clientSecretLength: clientSecret.length,
    clientIdFirst5: clientId.substring(0, 5),
    clientSecretFirst5: clientSecret.substring(0, 5),
  };

  if (!clientId || !clientSecret) {
    return res.json({ ...info, error: 'Variavel de ambiente vazia' });
  }

  try {
    const body = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    info.requestBodyLength = body.length;

    const oauthRes = await fetch('https://api.cakto.com.br/public_api/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    info.oauthStatus = oauthRes.status;
    const oauthText = await oauthRes.text();
    info.oauthResponse = oauthText;

    if (oauthRes.ok) {
      const oauthData = JSON.parse(oauthText);
      const token = oauthData.access_token;

      const ordersRes = await fetch(
        `https://api.cakto.com.br/public_api/orders/?customer=thiagoramos22%40hotmail.com&status=paid&limit=1`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );

      info.ordersStatus = ordersRes.status;
      info.ordersResponse = await ordersRes.text();
    }

    return res.json(info);
  } catch (err) {
    info.fetchError = err.message;
    return res.json(info);
  }
}
