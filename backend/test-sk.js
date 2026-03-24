require('dotenv').config();
const crypto = require('crypto');

const skRaw     = process.env.VOLC_SK;
const skDecode1 = Buffer.from(skRaw, 'base64').toString('utf8');
const skDecode2 = Buffer.from(skDecode1, 'base64').toString('utf8');

console.log('原始 SK 前20:', skRaw.slice(0, 20));
console.log('解码1次 前20:', skDecode1.slice(0, 20));
console.log('解码2次 前20:', skDecode2.slice(0, 20));

function sha256Hex(d) { return crypto.createHash('sha256').update(d).digest('hex'); }
function hmac(k, d)   { return crypto.createHmac('sha256', k).update(d).digest(); }
function hmacHex(k, d){ return crypto.createHmac('sha256', k).update(d).digest('hex'); }

async function tryWithSk(sk, label) {
  const ak = process.env.VOLC_AK;
  const body = JSON.stringify({
    req_key: 'foreground_segmentation',
    image_urls: ['https://www.volcengine.com/favicon.ico'],
    return_url: false,
  });
  const bodyHash = sha256Hex(body);
  const now = new Date();
  const dateTime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const date = dateTime.slice(0, 8);
  const host = 'visual.volcengineapi.com';
  const service = 'cv', region = 'cn-north-1';
  const action = 'CVProcess', version = '2022-08-31';
  const qs = `Action=${action}&Version=${version}`;
  const signedHeaders = 'content-type;host;x-date';
  const canonReq = [
    'POST', '/', qs,
    `content-type:application/json`, `host:${host}`, `x-date:${dateTime}`, '',
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
  const parsed = JSON.parse(text);
  console.log(`[${label}] HTTP:${resp.status} code:${parsed.code} msg:${parsed.message} elapsed:${parsed.time_elapsed}`);
}

async function main() {
  await tryWithSk(skRaw,     '未解码  ');
  await tryWithSk(skDecode1, '解码1次');
  await tryWithSk(skDecode2, '解码2次');
}
main().catch(console.error);
