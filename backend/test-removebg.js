// Quick test: download image → base64 → log what we send to Volcengine
const imgUrl = 'https://p3-aiop-sign.byteimg.com/tos-cn-i-vuqhorh59i/20260311170142034550CD5F75DC99E0C8-1892-0~tplv-vuqhorh59i-image-v1.image?rk3s=7f9e702d&x-expires=1773306104&x-signature=j3I5EyJg2l7uOchzExEMgV5umuY%3D';

async function run() {
  // Step 1: download image
  const imgRes = await fetch(imgUrl);
  console.log('图片下载 HTTP:', imgRes.status, imgRes.headers.get('content-type'));
  const buf = await imgRes.arrayBuffer();
  const imageBase64 = Buffer.from(buf).toString('base64');
  console.log('base64 前20字符:', imageBase64.slice(0, 20));
  console.log('base64 总长度:', imageBase64.length);

  // Step 2: call remove-bg
  const res = await fetch('http://localhost:5000/api/image/remove-bg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: imgUrl }),
  });
  console.log('remove-bg HTTP:', res.status);
  console.log('remove-bg 响应:', (await res.text()).slice(0, 200));
}

run().catch(console.error);
