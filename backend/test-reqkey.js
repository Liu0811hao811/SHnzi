require('dotenv').config();
const crypto = require('crypto');

function sha256Hex(d) { return crypto.createHash('sha256').update(d).digest('hex'); }
function hmac(k, d)   { return crypto.createHmac('sha256', k).update(d).digest(); }
function hmacHex(k, d){ return crypto.createHmac('sha256', k).update(d).digest('hex'); }

async function tryReqKey(reqKey) {
  const ak = process.env.VOLC_AK;
  const sk = process.env.VOLC_SK;
  const body = JSON.stringify({
    req_key: reqKey,
    image_urls: ['https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/240px-PNG_transparency_demonstration_1.png'],
    return_url: false,
  });
  const bodyHash = sha256Hex(body);
  const now = new Date();
  const dateTime = now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const date = dateTime.slice(0, 8);
  const host = 'visual.volcengineapi.com';
  const service = 'cv', region = 'cn-north-1';
  const action = 'CVProcess', version = '2022-08-31';
  const qs = `Action=${action}&Version=${version}`;
  const signedHeaders = 'content-type;host;x-date';
  const canonReq = [
    'POST', '/', qs,
    'content-type:application/json', `host:${host}`, `x-date:${dateTime}`, '',
    signedHeaders, bodyHash,
  ].join('\n');
  const credScope = `${date}/${region}/${service}/request`;
  const str2sign  = `HMAC-SHA256\n${dateTime}\n${credScope}\n${sha256Hex(canonReq)}`;
  const kDate    = hmac(sk, date);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');
  const sig  = hmacHex(kSigning, str2sign);
  const auth = `HMAC-SHA256 Credential=${ak}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const resp = await fetch(`https://${host}/?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Date': dateTime, 'Authorization': auth },
    body,
  });
  const text = await resp.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  const code = parsed.code ?? parsed.ResponseMetadata?.Error?.Code ?? '?';
  const msg  = parsed.message ?? parsed.ResponseMetadata?.Error?.Message ?? parsed._raw?.slice(0,60);
  console.log(`[${reqKey.padEnd(28)}] HTTP:${resp.status} code:${code} elapsed:${parsed.time_elapsed ?? '-'} msg:${msg}`);
}

async function main() {
  const keys = [
    'general_seg',
  ];
  for (const k of keys) {
    await tryReqKey(k);
    await new Promise(r => setTimeout(r, 300));
  }
}
main().catch(console.error);
