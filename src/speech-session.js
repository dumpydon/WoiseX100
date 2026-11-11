const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/.{2}/g) ?? [], pair => parseInt(pair, 16));

export async function speechSession(request, env) {
  if (!env.TTS_SESSION_SECRET) throw new Error('Speech sessions are not configured.');
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-woisex100-visitor' : 'woisex100-visitor';
  const value = request.headers.get('Cookie')?.split(';').map(pair => pair.trim()).find(pair => pair.startsWith(name + '='))?.slice(name.length + 1);
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.TTS_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  let id;
  if (/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value ?? '')) {
    const [candidate, signature] = value.split('.');
    if (await crypto.subtle.verify('HMAC', key, unhex(signature), encoder.encode('visitor:' + candidate))) id = candidate;
  }
  let cookie;
  if (!id) {
    id = crypto.randomUUID().replaceAll('-', '');
    const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode('visitor:' + id)));
    cookie = `${name}=${id}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`;
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const ipId = hex(await crypto.subtle.sign('HMAC', key, encoder.encode('ip:' + ip)));
  return { id, ipId, cookie };
}
