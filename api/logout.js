export default function handler(req, res) {
  res.setHeader('Set-Cookie',
    'privadao_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
  res.writeHead(302, { Location: '/' });
  res.end();
}
