/**
 * imageGen.js — 火山引擎文生图 + 扇面合成路由
 *
 * 路由：
 *   POST /api/image/generate   纯文生图（无模板）
 *   POST /api/image/inpaint    扇面合成（有模板，#111111 区域填入 AI 图）
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const Jimp    = require('jimp');
const path    = require('path');
const fs      = require('fs');
const { overlayMerchantText, hasContent } = require('./textOverlay');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// ─────────────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────────────
const VOLC_AK     = process.env.VOLC_AK || '';
const VOLC_SK     = process.env.VOLC_SK || '';
const REQ_KEY     = 'high_aes_general_v30l_zt2i';
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// ─────────────────────────────────────────────────────────────────────
// 图片风格配置
// ─────────────────────────────────────────────────────────────────────
const BASE_NEGATIVE = '文字，水印，字幕，标题，logo文字，text，watermark，blurry，low quality，ugly，oversaturated，deformed，extra limbs';

const STYLE_MAP = {
  photo: {
    promptSuffix: '，专业商业摄影，精致自然光影，超高清锐利细节，景深层次丰富，色彩真实通透，8K',
    negativeAdd:  '，动漫，卡通，插画，anime，cartoon，过度锐化，HDR过曝',
  },
  illustration: {
    promptSuffix: '，精美商业插画，细腻笔触，色彩层次丰富，光影立体，高品质平面设计感',
    negativeAdd:  '，模糊，粗糙，低质量',
  },
  chinese: {
    promptSuffix: '，中国传统工笔画，晕染层次细腻，古典意境深远，笔墨精到，构图典雅',
    negativeAdd:  '，动漫，卡通，anime，cartoon，写实照片，现代风格',
  },
  business: {
    promptSuffix: '，现代简约商务风，干净利落，专业质感，高端大气，视觉层次清晰，留白恰当',
    negativeAdd:  '，动漫，卡通，复杂杂乱背景，anime，cartoon',
  },
};

// 扇面颜色 #111111 = RGB(17,17,17)，容差 ±40
const FAN_R = 17, FAN_G = 17, FAN_B = 17;
const COLOR_TOLERANCE = 40;

function isFanFace(r, g, b) {
  return Math.abs(r - FAN_R) <= COLOR_TOLERANCE
      && Math.abs(g - FAN_G) <= COLOR_TOLERANCE
      && Math.abs(b - FAN_B) <= COLOR_TOLERANCE;
}

// alpha 通道分离式盒模糊羽化，消除抠图硬边锯齿
function featherAlpha(jimpImg, radius = 3) {
  const { width: w, height: h, data } = jimpImg.bitmap;
  const a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = data[i * 4 + 3];
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) { s += a[y * w + nx]; n++; }
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) { s += tmp[ny * w + x]; n++; }
      }
      data[(y * w + x) * 4 + 3] = Math.round(s / n);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 火山引擎 V4 签名
// ─────────────────────────────────────────────────────────────────────

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function buildAuthorization(ak, sk, { host, service, region, action, version, dateTime, bodyHash }) {
  const date          = dateTime.slice(0, 8);
  const queryString   = `Action=${action}&Version=${version}`;
  const signedHeaders = 'content-type;host;x-date';

  const canonicalRequest = [
    'POST', '/', queryString,
    `content-type:application/json`,
    `host:${host}`,
    `x-date:${dateTime}`,
    '', signedHeaders, bodyHash,
  ].join('\n');

  const credentialScope = `${date}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256', dateTime, credentialScope, sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate    = hmac(sk, date);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');
  const signature = hmacHex(kSigning, stringToSign);

  return `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function volcRequest({ service, host, region, action, version, body }) {
  const bodyStr  = JSON.stringify(body);
  const bodyHash = sha256Hex(bodyStr);
  const now      = new Date();
  const dateTime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const authorization = buildAuthorization(VOLC_AK, VOLC_SK, {
    host, service, region, action, version, dateTime, bodyHash,
  });

  const response = await fetch(`https://${host}/?Action=${action}&Version=${version}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Date': dateTime,
      'Authorization': authorization,
    },
    body: bodyStr,
  });

  const text = await response.text();
  console.log('[VolcEngine] status:', response.status);
  console.log('[VolcEngine] body:', text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { httpStatus: response.status, data };
}

// ─────────────────────────────────────────────────────────────────────
// 用 DashScope Qwen LLM 将用户业务描述智能转换为图片生成提示词
// ─────────────────────────────────────────────────────────────────────
const STYLE_LABEL = {
  photo:        '写实商业摄影风格，精致光影，真实质感',
  illustration: '精美商业插画风格，色彩鲜艳，笔触细腻',
  chinese:      '中国传统工笔画风格，古典意境，晕染层次',
  business:     '现代简约商务风格，干净利落，高端大气',
};

async function optimizeImagePrompt(userText, apiKey, genStyle = '') {
  if (!apiKey) return null;
  const styleHint = STYLE_LABEL[genStyle] ? `- 画面风格必须是：${STYLE_LABEL[genStyle]}` : '- 风格：商业广告感，色彩明亮鲜艳';
  const systemMsg = `你是顶级商业广告视觉设计师，同时精通文生图AI提示词写作。
用户会描述他们的业务类型或广告需求，你需要将其转换为专业、精准、富有设计感的图片生成提示词。
要求：
- 必须围绕用户的具体业务/产品展开，提取核心视觉元素（产品造型、材质、色彩、使用场景、行业氛围）
- 描述要具体精准：包含构图方式、色彩搭配、光影氛围、画面层次感等设计细节
- 有设计感：使用专业的视觉设计语言，体现商业美感与品牌调性
${styleHint}
- 画面要有适当留白，方便后期叠加文字
- 不要出现人物脸部，不要出现任何文字
- 只输出提示词本身，不需要任何解释或前缀，不超过80个汉字`;
  try {
    const res = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen-turbo',
          input: { messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userText }] },
          parameters: { max_tokens: 150, temperature: 0.7 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.output?.text?.trim() || null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────
// 调用火山引擎文生图
// ─────────────────────────────────────────────────────────────────────
async function volcT2I(prompt, width = 1024, height = 1024, genStyle = '') {
  if (!VOLC_AK || !VOLC_SK) {
    throw new Error('未配置火山引擎密钥，请检查 backend/.env 中的 VOLC_AK / VOLC_SK');
  }
  const style          = STYLE_MAP[genStyle] || {};
  const fullPrompt     = prompt.trim() + (style.promptSuffix || '') + '，无文字，无水印';
  const negativePrompt = BASE_NEGATIVE + (style.negativeAdd  || '');

  const { httpStatus, data } = await volcRequest({
    service: 'cv',
    host:    'visual.volcengineapi.com',
    region:  'cn-north-1',
    action:  'CVProcess',
    version: '2022-08-31',
    body: {
      req_key:         REQ_KEY,
      prompt:          fullPrompt,
      negative_prompt: negativePrompt,
      cfg_scale:       7,
      width, height,
      use_sr:     true,
      return_url: true,
      logo_info:  { add_logo: false },
    },
  });
  if (data.ResponseMetadata?.Error) {
    const e = data.ResponseMetadata.Error;
    throw new Error(`${e.Code}: ${e.Message}`);
  }
  if (data.code !== 10000) throw new Error(data.message || `生成失败（code: ${data.code}）`);
  if (data.data?.image_urls?.length)       return data.data.image_urls[0];
  if (data.data?.binary_data_base64?.length) return `data:image/jpeg;base64,${data.data.binary_data_base64[0]}`;
  throw new Error('接口未返回图片数据');
}

// ─────────────────────────────────────────────────────────────────────
// 图片工具
// ─────────────────────────────────────────────────────────────────────

async function fetchBuffer(url) {
  if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载图片失败 [${res.status}]: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 找出扇面真实包围盒（排除与图片边缘连通的背景 #111111）
 *
 * 模板结构：背景 + 扇面内部 都是 #111111，扇骨/边框是白色。
 * 通过从图片四条边 BFS flood fill，标记所有与边缘连通的 #111111 为"背景"，
 * 剩余 #111111 像素才是扇面内部（被白色边框围住，无法从边缘到达）。
 * 在 1/4 分辨率下操作以节省内存，结果换算回原始尺寸。
 */
async function findFanBoundingBox(tplBuf) {
  const tpl   = await Jimp.read(tplBuf);
  const origW = tpl.bitmap.width;
  const origH = tpl.bitmap.height;

  const S = 4;
  const w = Math.round(origW / S);
  const h = Math.round(origH / S);
  const small = tpl.clone().resize(w, h);
  const d = small.bitmap.data;

  const n  = w * h;
  const bg = new Uint8Array(n);   // 1 = 背景（从边缘 BFS 可达的 #111111）
  const q  = new Int32Array(n);
  let head = 0, tail = 0;

  // ── 第一步：BFS 标记背景 ──
  function seedBg(x, y) {
    const i = y * w + x;
    if (bg[i]) return;
    const p = i * 4;
    if (isFanFace(d[p], d[p + 1], d[p + 2])) { bg[i] = 1; q[tail++] = i; }
  }
  for (let x = 0; x < w; x++) { seedBg(x, 0); seedBg(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { seedBg(0, y); seedBg(w - 1, y); }
  while (head < tail) {
    const i = q[head++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0)     seedBg(x - 1, y);
    if (x < w - 1) seedBg(x + 1, y);
    if (y > 0)     seedBg(x, y - 1);
    if (y < h - 1) seedBg(x, y + 1);
  }

  // ── 第二步：连通分量分析，找出所有封闭 #111111 区域 ──
  const compId = new Int32Array(n);  // 0=非内部像素，>0=分量ID
  const comps  = [];                 // [{ id, size }]
  const bq     = new Int32Array(n);

  for (let si = 0; si < n; si++) {
    if (compId[si] || bg[si]) continue;
    const p0 = si * 4;
    if (!isFanFace(d[p0], d[p0 + 1], d[p0 + 2])) continue;

    const cid = comps.length + 1;
    let size = 0, bqH = 0, bqT = 0;
    compId[si] = cid;
    bq[bqT++] = si;

    while (bqH < bqT) {
      const i  = bq[bqH++];
      size++;
      const cx = i % w, cy = (i / w) | 0;
      if (cx > 0)     { const ni = i-1; if (!compId[ni] && !bg[ni]) { const np = ni*4; if (isFanFace(d[np], d[np+1], d[np+2])) { compId[ni]=cid; bq[bqT++]=ni; } } }
      if (cx < w - 1) { const ni = i+1; if (!compId[ni] && !bg[ni]) { const np = ni*4; if (isFanFace(d[np], d[np+1], d[np+2])) { compId[ni]=cid; bq[bqT++]=ni; } } }
      if (cy > 0)     { const ni = i-w; if (!compId[ni] && !bg[ni]) { const np = ni*4; if (isFanFace(d[np], d[np+1], d[np+2])) { compId[ni]=cid; bq[bqT++]=ni; } } }
      if (cy < h - 1) { const ni = i+w; if (!compId[ni] && !bg[ni]) { const np = ni*4; if (isFanFace(d[np], d[np+1], d[np+2])) { compId[ni]=cid; bq[bqT++]=ni; } } }
    }
    comps.push({ id: cid, size });
  }

  // ── 第三步：过滤，保留扇面主体，排除扇钉等小封闭区域 ──
  // 规则：保留 size ≥ max(最大分量 × 20%, 总内部像素 × 2%) 的分量
  const maxSize   = comps.reduce((m, c) => Math.max(m, c.size), 0);
  const totalInner = comps.reduce((s, c) => s + c.size, 0);
  const threshold = Math.max(maxSize * 0.20, totalInner * 0.02);
  const fanComps  = comps.filter(c => c.size >= threshold);
  const fanCidSet = new Set(fanComps.map(c => c.id));

  const sizes = comps.map(c => c.size).sort((a, b) => b - a);
  console.log(`  封闭区域共 ${comps.length} 个，大小：[${sizes.slice(0, 6).join(', ')}${sizes.length > 6 ? '…' : ''}]`);
  console.log(`  识别为扇面：${fanComps.length} 个，排除小区域：${comps.length - fanComps.length} 个`);

  // ── 第四步：计算扇面包围盒 ──
  let minX = w, minY = h, maxX = 0, maxY = 0, innerCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!fanCidSet.has(compId[i])) continue;
      innerCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  console.log(`  扇面包围盒（小图）：(${minX},${minY})→(${maxX},${maxY})，${innerCount} 像素`);

  if (innerCount === 0) {
    return { minX: 0, minY: 0, maxX: origW - 1, maxY: origH - 1, bg, compId, fanCidSet, smallW: w, smallH: h, scale: S };
  }

  const pad = S * 2;
  return {
    minX: Math.max(0,         minX * S - pad),
    minY: Math.max(0,         minY * S - pad),
    maxX: Math.min(origW - 1, maxX * S + pad),
    maxY: Math.min(origH - 1, maxY * S + pad),
    bg, compId, fanCidSet, smallW: w, smallH: h, scale: S,
  };
}

/**
 * 合成最终图
 *  步骤 1：AI 图 cover 到扇面包围��，替换「扇面主体」连通分量像素（排除扇钉等小区域）
 *  步骤 2：扫描原始模板，将非扇面主体的 #111111 像素在输出中设为透明
 *          （背景 + 扇钉等小封闭区域 → 透明；扇面像素已被 AI 内容替换 → 不触碰）
 *  结果：透明背景，AI 内容填充不规则扇面，扇骨/边框保留，扇钉区域透明
 *
 *  注意：此函数在全分辨率下做 BFS + 连通分量分析，彻底消除 1/4 缩放导致的
 *        边界误判（圆形扇面右侧/边缘留白问题）。
 */
async function compositeResult(templateBuf, resultBuf, bbox) {
  const { minX, minY, maxX, maxY } = bbox;

  const tpl    = await Jimp.read(templateBuf);
  let   result = await Jimp.read(resultBuf);
  const { width: tplW, height: tplH } = tpl.bitmap;
  const fanW = maxX - minX + 1;
  const fanH = maxY - minY + 1;

  console.log(`  AI 图缩放至扇面包围盒：${fanW}×${fanH}`);
  result.cover(fanW, fanH, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, Jimp.RESIZE_HERMITE);

  const output  = tpl.clone();
  const tplData = tpl.bitmap.data;
  const outData = output.bitmap.data;
  const aiData  = result.bitmap.data;
  const aiW     = result.bitmap.width;
  const n       = tplW * tplH;

  // ── 全分辨率 BFS：标记从图像边缘可达的 #111111 像素（= 背景）──────────
  // 这样即使是圆形扇面边界 1 像素处也能被精确区分，不受缩放插值干扰。
  const isBg = new Uint8Array(n);
  const q    = new Int32Array(n);
  let qHead = 0, qTail = 0;

  function seedBg(x, y) {
    const i = y * tplW + x;
    if (isBg[i]) return;
    const p = i * 4;
    if (isFanFace(tplData[p], tplData[p + 1], tplData[p + 2])) {
      isBg[i] = 1;
      q[qTail++] = i;
    }
  }
  for (let x = 0; x < tplW; x++) { seedBg(x, 0); seedBg(x, tplH - 1); }
  for (let y = 1; y < tplH - 1; y++) { seedBg(0, y); seedBg(tplW - 1, y); }
  while (qHead < qTail) {
    const i = q[qHead++];
    const x = i % tplW, y = (i / tplW) | 0;
    if (x > 0)       seedBg(x - 1, y);
    if (x < tplW - 1) seedBg(x + 1, y);
    if (y > 0)       seedBg(x, y - 1);
    if (y < tplH - 1) seedBg(x, y + 1);
  }

  // ── 全分辨率连通分量：区��扇面主体 vs 扇钉等小封闭区域 ──────────────
  const compId = new Int32Array(n);
  const comps  = [];
  const bq     = new Int32Array(n);

  for (let si = 0; si < n; si++) {
    if (compId[si] || isBg[si]) continue;
    const p0 = si * 4;
    if (!isFanFace(tplData[p0], tplData[p0 + 1], tplData[p0 + 2])) continue;

    const cid = comps.length + 1;
    let size = 0, bqH = 0, bqT = 0;
    compId[si] = cid;
    bq[bqT++] = si;

    while (bqH < bqT) {
      const i  = bq[bqH++];
      size++;
      const cx = i % tplW, cy = (i / tplW) | 0;
      if (cx > 0)        { const ni = i - 1;    if (!compId[ni] && !isBg[ni]) { const np = ni * 4; if (isFanFace(tplData[np], tplData[np+1], tplData[np+2])) { compId[ni] = cid; bq[bqT++] = ni; } } }
      if (cx < tplW - 1) { const ni = i + 1;    if (!compId[ni] && !isBg[ni]) { const np = ni * 4; if (isFanFace(tplData[np], tplData[np+1], tplData[np+2])) { compId[ni] = cid; bq[bqT++] = ni; } } }
      if (cy > 0)        { const ni = i - tplW; if (!compId[ni] && !isBg[ni]) { const np = ni * 4; if (isFanFace(tplData[np], tplData[np+1], tplData[np+2])) { compId[ni] = cid; bq[bqT++] = ni; } } }
      if (cy < tplH - 1) { const ni = i + tplW; if (!compId[ni] && !isBg[ni]) { const np = ni * 4; if (isFanFace(tplData[np], tplData[np+1], tplData[np+2])) { compId[ni] = cid; bq[bqT++] = ni; } } }
    }
    comps.push({ id: cid, size });
  }

  const maxSize    = comps.reduce((m, c) => Math.max(m, c.size), 0);
  const totalInner = comps.reduce((s, c) => s + c.size, 0);
  const threshold  = Math.max(maxSize * 0.20, totalInner * 0.02);
  const fanCidSet  = new Set(comps.filter(c => c.size >= threshold).map(c => c.id));
  console.log(`  全分辨率：封闭区域 ${comps.length} 个，扇面主体 ${fanCidSet.size} 个`);

  // 步骤 1：扇面主体像素替换为 AI 内容
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = (y * tplW + x) * 4;
      if (!isFanFace(tplData[idx], tplData[idx + 1], tplData[idx + 2])) continue;
      if (!fanCidSet.has(compId[y * tplW + x])) continue;

      const aiX   = Math.min(x - minX, fanW - 1);
      const aiY   = Math.min(y - minY, fanH - 1);
      const aiIdx = (aiY * aiW + aiX) * 4;
      outData[idx]     = aiData[aiIdx];
      outData[idx + 1] = aiData[aiIdx + 1];
      outData[idx + 2] = aiData[aiIdx + 2];
      outData[idx + 3] = aiData[aiIdx + 3];
    }
  }

  // 步骤 2：背景 + 小封闭区域（扇钉等）→ 透明
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (!isFanFace(tplData[p], tplData[p + 1], tplData[p + 2])) continue;
    if (fanCidSet.has(compId[i])) continue;
    outData[p + 3] = 0;
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────
// PNG → PDF 转换（纯 JS，无外部依赖，CorelDRAW 可直接导入）
// ─────────────────────────────────────────────────────────────────────
async function pngToPDF(pngBuf, host) {
  const pdfDoc  = await PDFDocument.create();
  const pngImg  = await pdfDoc.embedPng(pngBuf);
  const { width: W, height: H } = pngImg;
  const page = pdfDoc.addPage([W, H]);
  page.drawImage(pngImg, { x: 0, y: 0, width: W, height: H });
  const pdfBytes = await pdfDoc.save();

  const base    = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pdfPath = path.join(UPLOADS_DIR, `${base}.pdf`);
  fs.writeFileSync(pdfPath, pdfBytes);
  return `http://${host}/uploads/${base}.pdf`;
}

async function saveToUploads(jimpImg, host) {
  const filename = `fan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const filepath = path.join(UPLOADS_DIR, filename);
  const buf = await jimpImg.getBufferAsync(Jimp.MIME_PNG);
  fs.writeFileSync(filepath, buf);
  const url = `http://${host}/uploads/${filename}`;

  let pdfUrl = null;
  try {
    pdfUrl = await pngToPDF(buf, host);
    console.log('  ✓ PDF 已生成');
  } catch (e) {
    console.warn('  ⚠ PDF 生成失败:', e.message);
  }
  return { url, cdrUrl: pdfUrl };
}

// ─────────────────────────────────────────────────────────────────────
// 路由
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/image/generate
 * 纯文生图（无模板）
 */
router.post('/generate', async (req, res) => {
  const { prompt, rawScene, size = '1024x1024', merchantInfo, genStyle = '' } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ message: '请输入提示词' });

  const [width, height] = size.replace('*', 'x').split('x').map(Number);
  if (!width || !height) return res.status(400).json({ message: `不支持的尺寸格式：${size}` });

  try {
    console.log(`\n▶ 文生图  prompt="${prompt}"  size=${width}x${height}  style=${genStyle||'默认'}`);
    // 用原始话术（rawScene）给 Qwen 优化，避免风格后缀干扰
    const DASHSCOPE_KEY_GEN = process.env.DASHSCOPE_KEY || '';
    const textForQwen = (rawScene || '').trim() || prompt.trim();
    let optimizedPrompt = null;
    try {
      optimizedPrompt = await optimizeImagePrompt(textForQwen, DASHSCOPE_KEY_GEN, genStyle);
      if (optimizedPrompt) console.log(`  ✓ 优化后提示词：${optimizedPrompt}`);
    } catch (e) {
      console.warn('  ⚠ 提示词优化失败，使用原始提示词:', e.message);
    }
    // Qwen 优化结果直接传给 volcT2I，volcT2I 内部会追加风格后缀
    const finalPrompt = optimizedPrompt || prompt;
    let imgUrl = await volcT2I(finalPrompt, width, height, genStyle);
    let cdrUrl = null;

    // 无模板场景：若有商家信息则在图上叠加文字
    if (hasContent(merchantInfo)) {
      console.log('  叠加商家文字（无模板）…');
      const rawBuf   = await fetchBuffer(imgUrl);
      const overlaid = await overlayMerchantText(rawBuf, merchantInfo, { genStyle });
      const filename = `gen-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), overlaid);
      imgUrl = `http://${req.get('host')}/uploads/${filename}`;
      try { cdrUrl = await pngToPDF(overlaid, req.get('host')); } catch (e) {
        console.warn('  ⚠ CDR 转换失败:', e.message);
      }
    } else {
      try {
        const rawBuf = await fetchBuffer(imgUrl);
        cdrUrl = await pngToPDF(rawBuf, req.get('host'));
      } catch (e) {
        console.warn('  ⚠ CDR 转换失败:', e.message);
      }
    }

    console.log('  ✓ 完成');
    res.json({ images: [{ url: imgUrl, cdrUrl }], optimizedPrompt });
  } catch (err) {
    console.error('  ✗', err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/image/inpaint
 * 扇面合成（有模板）
 *
 * 流程：
 *  1. 下载模板（保持原始尺寸）
 *  2. BFS flood fill 找出真实扇面包围盒（排除背景 #111111）
 *  3. 根据包围盒宽高比选最优 T2I 尺寸，调用火山引擎文生图
 *  4. AI 图 cover 到包围盒尺寸后逐像素合成，模板框架完整保留
 */
router.post('/inpaint', async (req, res) => {
  console.log('[Inpaint] body:', JSON.stringify(req.body));
  const { templateUrl, prompt } = req.body || {};

  if (!prompt?.trim()) return res.status(400).json({ error: '请输入提示词' });
  if (!templateUrl)    return res.status(400).json({ error: '请先选择扇子模板' });

  try {
    console.log(`\n▶ 扇面合成  prompt="${prompt}"`);

    // 1. 下载模板，保持原始尺寸
    console.log('  [1/3] 下载模板…');
    const tplBuf = await fetchBuffer(templateUrl);
    const tplImg = await Jimp.read(tplBuf);
    const tplW   = tplImg.bitmap.width;
    const tplH   = tplImg.bitmap.height;
    console.log(`  模板尺寸：${tplW}x${tplH}`);

    // 验证至少有扇面像素
    let fanPixelCount = 0;
    tplImg.scan(0, 0, tplW, tplH, function(x, y, idx) {
      if (isFanFace(this.bitmap.data[idx], this.bitmap.data[idx+1], this.bitmap.data[idx+2]))
        fanPixelCount++;
    });
    if (fanPixelCount < 500) throw new Error(`未检测到扇面区域（${fanPixelCount} 像素）`);
    console.log(`  扇面像素总数：${fanPixelCount}`);

    // 2. BFS 找真实扇面包围盒（排除背景）
    console.log('  [2/3] BFS 识别扇面内部区域…');
    const tplBufOrig = await tplImg.getBufferAsync(Jimp.MIME_PNG);
    const bbox = await findFanBoundingBox(tplBufOrig);
    const bbW  = bbox.maxX - bbox.minX + 1;
    const bbH  = bbox.maxY - bbox.minY + 1;
    console.log(`  扇面包围盒（原始分辨率）：(${bbox.minX},${bbox.minY})→(${bbox.maxX},${bbox.maxY})，${bbW}x${bbH}`);

    // 根据包围盒宽高比选最合适的 T2I 尺寸
    const ratio = bbW / bbH;
    let t2iW = 1024, t2iH = 1024;
    if (ratio >= 1.4)       { t2iW = 1280; t2iH = 720; }
    else if (ratio <= 0.72) { t2iW = 720;  t2iH = 1280; }
    console.log(`  包围盒比例 ${ratio.toFixed(2)} → T2I ${t2iW}x${t2iH}`);

    // 3. 文生图：先用 Qwen LLM 将用户描述智能转换为画面提示词，再生成背景图
    console.log('  [3/3] Qwen 优化提示词…');
    const DASHSCOPE_KEY = process.env.DASHSCOPE_KEY || '';
    let optimizedPrompt = null;
    try {
      optimizedPrompt = await optimizeImagePrompt(prompt.trim(), DASHSCOPE_KEY, genStyle);
      if (optimizedPrompt) console.log(`  ✓ 优化后提示词：${optimizedPrompt}`);
    } catch (e) {
      console.warn('  ⚠ 提示词优化失败，使用兜底方案:', e.message);
    }
    // 优化失败时降级到固定前后缀拼接
    const finalPrompt = optimizedPrompt
      || `广告扇面背景设计，平面设计风格，适合商业印刷，${prompt.trim()}，色彩明亮，构图简洁大气，无人物`;
    console.log('  火山引擎文生图…');
    const aiUrl = await volcT2I(finalPrompt, t2iW, t2iH);

    // 4. 合成
    console.log('  合成最终图片…');
    const aiBuf    = await fetchBuffer(aiUrl);
    const finalImg = await compositeResult(tplBufOrig, aiBuf, bbox);

    const { url: finalUrl, cdrUrl } = await saveToUploads(finalImg, req.get('host'));
    console.log(`  ✓ 完成：${finalUrl}`);
    res.json({ images: [{ url: finalUrl, cdrUrl }] });

  } catch (err) {
    console.error('  ✗ inpaint:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/image/remove-bg
 * 去除图片背景（火山引擎 img_matting 抠图）
 *
 * body: { imageUrl }  — 支持 http URL 或 data:image/... base64
 * 返回: { imageUrl }  — 透明背景 PNG 的 http URL
 */
router.post('/remove-bg', async (req, res) => {
  const { imageUrl } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: '请提供 imageUrl' });

  try {
    console.log('\n▶ 去背景');

    // 若是 base64 先落盘
    let srcUrl = imageUrl;
    if (imageUrl.startsWith('data:')) {
      const b64  = imageUrl.split(',')[1];
      const buf  = Buffer.from(b64, 'base64');
      const fname = `rmbg-src-${Date.now()}-${Math.random().toString(36).slice(2,6)}.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
      srcUrl = `http://${req.get('host')}/uploads/${fname}`;
    }

    const { httpStatus, data } = await volcRequest({
      service: 'cv', host: 'visual.volcengineapi.com',
      region: 'cn-north-1', action: 'CVProcess', version: '2022-08-31',
      body: {
        req_key:    'img_matting_v2.0_sa',
        image_url:  srcUrl,
        return_url: true,
      },
    });

    if (data.code !== 10000) throw new Error(data.message || `去背景失败 code:${data.code}`);
    const outUrl = data.data?.image_urls?.[0];
    if (!outUrl) throw new Error('未返回透明图片');

    console.log('  ✓ 去背景完成');
    res.json({ imageUrl: outUrl });
  } catch (err) {
    // 去背景失败时降级返回原图，前端流程不中断
    console.warn('  ⚠ 去背景失败，降级返回原图:', err.message);
    res.json({ imageUrl, fallback: true });
  }
});

/**
 * POST /api/image/fusion
 * AI 图像融合：将参考图以场景材质风格嵌入场景（DashScope wanx-x-painting Inpainting）
 *
 * body: { scene, baseImage, images, imageTypes, size }
 *   scene     — 场景文本描述（用于 prompt 生成）
 *   baseImage — ��生成的场景图 URL（作为 inpainting 的底图）
 *   images    — 参考图数组（base64 data URL 或 http URL）
 *   imageTypes— 对应类型数组（'logo'|'product'|'other'）
 *   size      — 底图尺寸，默认 '1024x1024'（用于生成蒙版）
 * 返回: { images: [{ url }] }
 */
router.post('/fusion', async (req, res) => {
  const DASHSCOPE_KEY = process.env.DASHSCOPE_KEY || '';
  const { scene, baseImage, images, imageTypes, imageInstructions } = req.body || {};
  if (!baseImage)      return res.status(400).json({ error: '缺少 baseImage' });
  if (!images?.length) return res.status(400).json({ error: '缺少参考图 images' });

  try {
    console.log(`\n▶ 融合  scene="${(scene||'').slice(0,30)}"  refs=${images.length}`);

    // ── 1. 加载场景图 ──
    const sceneBuf = await fetchBuffer(baseImage);
    const sceneImg = await Jimp.read(sceneBuf);
    const sW = sceneImg.bitmap.width;
    const sH = sceneImg.bitmap.height;
    console.log(`  场景图：${sW}×${sH}`);

    // ── 2. 将参考图去白底后合成进场景，记录放置坐标 ──
    const maxRefW  = Math.round(sW * 0.44);
    const maxRefH  = Math.round(sH * 0.30);
    const gap      = Math.round(sH * 0.03);
    let   yOffset  = Math.round(sH * 0.12);
    const placements = [];

    for (let i = 0; i < images.length; i++) {
      const imgType = imageTypes?.[i] || 'other';
      const instr   = imageInstructions?.[i] || '';
      const refBuf  = await fetchBuffer(images[i]);
      const refImg  = await Jimp.read(refBuf);

      // 去除浅色/白色背景：平滑阈值（亮度高且饱和度低）+ 羽化边缘
      const d = refImg.bitmap.data;
      for (let p = 0; p < d.length; p += 4) {
        const r = d[p], g = d[p + 1], b = d[p + 2];
        const maxC = Math.max(r, g, b);
        const sat  = maxC - Math.min(r, g, b);
        if (maxC > 200 && sat < 40) {
          const whiteness = maxC - sat * 1.5;
          d[p + 3] = Math.min(d[p + 3], Math.max(0, Math.round((255 - whiteness) * 4)));
        }
      }
      featherAlpha(refImg, 3);

      const rW = refImg.bitmap.width;
      const rH = refImg.bitmap.height;

      // 括号内缩放指令
      let sizeScale = 1.0;
      if      (/放大|大一些|稍大/.test(instr)) sizeScale = 1.4;
      else if (/缩小|小一些|稍小/.test(instr)) sizeScale = 0.7;
      const baseScale = Math.min(maxRefW / rW, maxRefH / rH, 1);
      const newW = Math.max(1, Math.round(rW * baseScale * sizeScale));
      const newH = Math.max(1, Math.round(rH * baseScale * sizeScale));
      refImg.resize(newW, newH);

      // 括号内方位指令（有指令则按方位；无指令则自动纵向堆叠居中）
      let x, y;
      const pad = Math.round(sH * 0.05);
      if (instr) {
        if      (/左/.test(instr)) x = pad;
        else if (/右/.test(instr)) x = sW - newW - pad;
        else                       x = Math.round((sW - newW) / 2);
        if      (/上/.test(instr)) y = pad;
        else if (/下/.test(instr)) y = sH - newH - pad;
        else                       y = Math.round((sH - newH) / 2);
      } else {
        x = Math.round((sW - newW) / 2);
        y = Math.min(yOffset, sH - newH);
        yOffset += newH + gap;
      }
      x = Math.max(0, Math.min(sW - newW, x));
      y = Math.max(0, Math.min(sH - newH, y));
      console.log(`  参考图 ${i+1} [${imgType}] instr="${instr}"：${newW}×${newH} @ (${x},${y})`);

      sceneImg.composite(refImg, x, y, {
        mode: Jimp.BLEND_SOURCE_OVER,
        opacitySource: 1, opacityDest: 1,
      });
      placements.push({ x, y, w: newW, h: newH });
    }

    // Jimp 合成结果（DashScope 失败时回退用）
    const compositeBuf = await sceneImg.getBufferAsync(Jimp.MIME_PNG);

    // ── 无 DashScope key → 直接返回 Jimp ──
    if (!DASHSCOPE_KEY) {
      const fn = `fusion-${Date.now()}-${Math.random().toString(36).slice(2,8)}.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, fn), compositeBuf);
      const url = `http://${req.get('host')}/uploads/${fn}`;
      console.log(`  ✓ Jimp 完成（无 DashScope key）：${url}`);
      return res.json({ images: [{ url }] });
    }

    // ── 3. 生成蒙版：仅覆盖参考图放置区域（+2% 边距）──
    const mask = new Jimp(sW, sH, 0x000000ff);
    const pad  = Math.round(sH * 0.02);
    for (const { x, y, w, h } of placements) {
      const x1 = Math.max(0,      x - pad);
      const y1 = Math.max(0,      y - pad);
      const x2 = Math.min(sW - 1, x + w + pad);
      const y2 = Math.min(sH - 1, y + h + pad);
      for (let py = y1; py <= y2; py++)
        for (let px = x1; px <= x2; px++)
          mask.setPixelColor(0xffffffff, px, py);
    }
    const maskBase64      = await mask.getBase64Async(Jimp.MIME_PNG);
    const compositeBase64 = `data:image/png;base64,${compositeBuf.toString('base64')}`;

    // ── 4. 提交 DashScope（底图已含 logo，仅对 logo 区域做风格融合）──
    const prompt = scene?.trim()
      ? `保持画面中品牌标志/logo的文字与图案内容完整，以${scene}的材质、光影、风格将其自然融合进背景，使其看起来像是印刷或喷绘在背景上`
      : '保持画面中品牌标志的文字与图案内容完整，使其与背景材质自然融合，像是印刷在背景上';

    console.log(`  蒙版：${placements.length} 个区域，提交 DashScope…`);
    const submitRes = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${DASHSCOPE_KEY}`,
          'Content-Type':      'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: 'wanx-x-painting',
          input: {
            function:       'description_edit_with_mask',
            prompt,
            base_image_url: compositeBase64,
            mask_image_url: maskBase64,
          },
          parameters: { n: 1 },
        }),
      }
    );

    const submitData = await submitRes.json();
    console.log(`  [DashScope] submit HTTP:${submitRes.status}`, JSON.stringify(submitData).slice(0,120));

    if (!submitData.output?.task_id) {
      console.warn('  ⚠ DashScope 提交失败，回退 Jimp');
      const fn = `fusion-${Date.now()}-${Math.random().toString(36).slice(2,8)}.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, fn), compositeBuf);
      return res.json({ images: [{ url: `http://${req.get('host')}/uploads/${fn}` }] });
    }

    const taskId = submitData.output.task_id;

    // ── 5. 轮询结果（最多 90 秒）──
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes  = await fetch(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        { headers: { 'Authorization': `Bearer ${DASHSCOPE_KEY}` } }
      );
      const pollData = await pollRes.json();
      const status   = pollData.output?.task_status;
      console.log(`  [DashScope] poll #${i+1} status:${status}`);

      if (status === 'SUCCEEDED') {
        const imgUrl = pollData.output.results?.[0]?.url;
        if (imgUrl) {
          console.log('  ✓ DashScope 融合完成');
          return res.json({ images: [{ url: imgUrl }] });
        }
      }
      if (status === 'FAILED') {
        console.warn('  ⚠ DashScope 失败:', pollData.output?.message || pollData.output?.code);
        break;
      }
    }

    // 超时或失败 → 回退 Jimp
    console.warn('  ⚠ DashScope 超时/失败，回退 Jimp 合成图');
    const fn = `fusion-${Date.now()}-${Math.random().toString(36).slice(2,8)}.png`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fn), compositeBuf);
    res.json({ images: [{ url: `http://${req.get('host')}/uploads/${fn}` }] });

  } catch (err) {
    console.error('  ✗ fusion:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/image/composite-template
 * 将已有图片套入扇面模板（不调用文生图，直接合成）
 *
 * body: { imageUrl, templateUrl }
 * 返回: { images: [{ url }] }
 */
router.post('/composite-template', async (req, res) => {
  const { imageUrl, templateUrl, merchantInfo, genStyle = '', imageElements } = req.body || {};
  console.log(`  [composite-template] imageElements 收到: ${imageElements ? imageElements.length + ' 个' : 'undefined/null'}`);
  if (!imageUrl)    return res.status(400).json({ error: '请提供 imageUrl' });
  if (!templateUrl) return res.status(400).json({ error: '请提供 templateUrl' });

  try {
    console.log('\n▶ 套扇面模板');

    // 下载模板
    const tplBuf = await fetchBuffer(templateUrl);
    const tplImg = await Jimp.read(tplBuf);
    console.log(`  模板尺寸：${tplImg.bitmap.width}x${tplImg.bitmap.height}`);

    const tplBufOrig = await tplImg.getBufferAsync(Jimp.MIME_PNG);

    // BFS 找扇面包围盒
    const bbox = await findFanBoundingBox(tplBufOrig);
    const bbW  = bbox.maxX - bbox.minX + 1;
    const bbH  = bbox.maxY - bbox.minY + 1;
    console.log(`  扇面包围盒：(${bbox.minX},${bbox.minY})→(${bbox.maxX},${bbox.maxY})，${bbW}x${bbH}`);

    // 下载 AI 图，先 cover 缩放到扇面包围盒尺寸，再叠加文字
    // 这样文字坐标系与扇面一致，不会被后续 cover 操作二次裁剪
    let aiBuf = await fetchBuffer(imageUrl);
    const aiImg = await Jimp.read(aiBuf);
    aiImg.cover(bbW, bbH, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, Jimp.RESIZE_HERMITE);
    aiBuf = await aiImg.getBufferAsync(Jimp.MIME_PNG);

    // 保存"干净"AI 图（叠字前），供后续文字位置重新编辑
    let cleanScaledUrl    = null;
    let cleanCompositeUrl = null;
    let initialFraction   = null;
    let textLines         = [];
    let imageElementsUsed = null;

    console.log(`  [composite-template] merchantInfo:`, merchantInfo);
    console.log(`  [composite-template] hasContent:`, hasContent(merchantInfo));

    if (hasContent(merchantInfo)) {
      // 计算默认文字中心分数（与 textOverlay.js 安全区逻辑保持一致）
      const ratio = bbW / bbH;
      let safeTop, safeBottom;
      if      (ratio <= 0.9)  { safeTop = 0.22; safeBottom = 0.70; }
      else if (ratio >= 1.4)  { safeTop = 0.18; safeBottom = 0.65; }
      else                    { safeTop = 0.20; safeBottom = 0.68; }
      initialFraction = safeTop + (safeBottom - safeTop) * 0.52;

      // 保存干净 AI 图，供 recomposite-text 渲染背景用
      const cleanFname = `clean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, cleanFname), aiBuf);
      cleanScaledUrl = `http://${req.get('host')}/uploads/${cleanFname}`;

      const bgStyleMap = { photo: 'festive', chinese: 'elegant', business: 'festive', illustration: 'festive' };

      // 生成背景底图（无文字），合成进扇面模板，供编辑器展示
      const bgOnlyBuf    = await renderAdBackground(aiBuf, bbW, bbH, bgStyleMap[genStyle] || 'festive');
      const bgOnlyFanImg = await compositeResult(tplBufOrig, bgOnlyBuf, bbox);
      const bgOnlyPng    = await bgOnlyFanImg.getBufferAsync(Jimp.MIME_PNG);
      const bgOnlyFname  = `bgonly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      fs.writeFileSync(path.join(UPLOADS_DIR, bgOnlyFname), bgOnlyPng);
      cleanCompositeUrl  = `http://${req.get('host')}/uploads/${bgOnlyFname}`;
      console.log(`  背景底图：${cleanCompositeUrl}`);

      console.log(`  广告排版渲染（canvas，扇面尺寸 ${bbW}×${bbH}）…`);
      const adConfig = {
        companyName:   merchantInfo.shopName   || '',
        headline:      merchantInfo.mainTitle  || '',
        subheadline:   merchantInfo.subTitle   || '',
        subheadlines:  merchantInfo.subTitles  || [],
        phone:         merchantInfo.phone      || '',
        address:       merchantInfo.address    || '',
        qrText:        merchantInfo.qrText     || '',
        promoItems:    merchantInfo.promoItems || [],
        bgStyle:       bgStyleMap[genStyle]    || 'festive',
      };
      const { buffer: posterBuf, textLayout } = await renderAdPoster(adConfig, aiBuf, bbW, bbH);
      aiBuf     = posterBuf;
      textLines = textLayout || [];

      // 叠加用户上传的图片元素（如 LOGO），默认定位到手机号上方
      if (imageElements && imageElements.length > 0) {
        console.log(`  叠加用户图片元素 ${imageElements.length} 个…`);
        // 首次合成：自动定位到手机号左上方（手机号 Y≈78%，图片中心 Y≈63%，X≈22%）
        const positioned = merchantInfo?.phone
          ? imageElements.map(el => ({ ...el, x: 0.22, y: 0.63 }))
          : imageElements;
        imageElementsUsed = positioned.map(el => ({
          x: el.x, y: el.y,
          width: el.width || 0.18,
          height: el.height || null,
          rotation: el.rotation || 0,
        }));
        aiBuf = await overlayImageElements(aiBuf, positioned, bbW, bbH);
      }
    }
    const finalImg = await compositeResult(tplBufOrig, aiBuf, bbox);

    const { url: finalUrl, cdrUrl } = await saveToUploads(finalImg, req.get('host'));
    console.log(`  ✓ 完成：${finalUrl}`);
    res.json({
      images: [{ url: finalUrl }],
      fanBox: { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
      cleanScaledUrl,
      cleanCompositeUrl,
      bbW,
      bbH,
      templateUrl: req.body.templateUrl,
      initialFraction,
      cdrUrl,
      textLines: textLines || [],
      imageElementsUsed,
    });
  } catch (err) {
    console.error('  ✗ composite-template:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 将前端传来的图片元素（如LOGO）叠加到文字图上
 * @param {Buffer} baseBuf  文字叠加后的图片 Buffer
 * @param {Array}  elements [{ src, x, y, width, height, rotation }]
 * @param {number} bboxW    扇面宽度（像素）
 * @param {number} bboxH    扇面高度（像素）
 * @returns {Promise<Buffer>}
 */
async function overlayImageElements(baseBuf, elements, bboxW, bboxH) {
  if (!elements || elements.length === 0) return baseBuf;
  console.log(`  [overlayImg] canvas ${bboxW}×${bboxH}, ${elements.length} 个元素`);
  const canvas = createCanvas(bboxW, bboxH);
  const ctx = canvas.getContext('2d');
  const baseImg = await loadImage(baseBuf);
  ctx.drawImage(baseImg, 0, 0, bboxW, bboxH);
  for (const el of elements) {
    try {
      if (!el.src || typeof el.src !== 'string') { console.warn('  [overlayImg] 跳过：src无效'); continue; }
      const base64Data = el.src.includes(',') ? el.src.split(',')[1] : el.src;
      console.log(`  [overlayImg] base64 长度: ${base64Data.length}`);
      const imgBuf = Buffer.from(base64Data, 'base64');
      console.log(`  [overlayImg] imgBuf 大小: ${imgBuf.length} bytes`);
      const img = await loadImage(imgBuf);
      console.log(`  [overlayImg] 图片尺寸: ${img.width}×${img.height}`);
      const w  = Math.round((el.width  || 0.18) * bboxW);
      const h  = Math.round((el.height || 0.18) * bboxH);
      const cx = (el.x != null ? el.x : 0.5) * bboxW;
      const cy = (el.y != null ? el.y : 0.5) * bboxH;
      console.log(`  [overlayImg] 绘制: center(${Math.round(cx)},${Math.round(cy)}) size ${w}×${h}`);
      ctx.save();
      ctx.translate(cx, cy);
      if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      console.log(`  [overlayImg] 绘制完成`);
    } catch (e) {
      console.warn('  [overlayImg] 跳过元素，错误:', e.message, e.stack);
    }
  }
  const outBuf = canvas.toBuffer('image/png');
  console.log(`  [overlayImg] 输出 buffer: ${outBuf.length} bytes`);
  return outBuf;
}

/**
 * POST /api/image/recomposite-text
 * 以新文字中心分数重新合成扇面图（供前端编辑器调用）
 * 支持新旧两种模式:
 * - 新模式: textLines 数组，每行文字独立配置
 * - 旧模式: textCenterFraction 整体文字块位置
 */
router.post('/recomposite-text', async (req, res) => {
  const { cleanScaledUrl, templateUrl, merchantInfo, genStyle = '',
          textCenterFraction, textCenterX, szMult, textLines, fanW, fanH,
          imageElements } = req.body || {};
  if (!cleanScaledUrl || !templateUrl || !hasContent(merchantInfo)) {
    return res.status(400).json({ message: '参数不完整' });
  }

  const useNewMode = textLines && Array.isArray(textLines) && textLines.length > 0;
  if (!useNewMode && textCenterFraction == null) {
    return res.status(400).json({ message: '参数不完整' });
  }

  try {
    if (useNewMode) {
      console.log(`\n▶ 重新合成文字 [新模式]  ${textLines.length} 行`);
    } else {
      console.log(`\n▶ 重新合成文字 [旧模式]  fraction=${Number(textCenterFraction).toFixed(3)}`);
    }

    // 先获取模板和扇面尺寸
    const tplBuf     = await fetchBuffer(templateUrl);
    const tplImg     = await Jimp.read(tplBuf);
    const tplBufOrig = await tplImg.getBufferAsync(Jimp.MIME_PNG);
    const bbox       = await findFanBoundingBox(tplBufOrig);
    
    // bbox 的实际尺寸（compositeResult 会将文字图缩放至此尺寸）
    const bboxW = bbox.maxX - bbox.minX;
    const bboxH = bbox.maxY - bbox.minY;
    console.log(`  [recomposite-text] bbox 尺寸: ${bboxW}×${bboxH}`);

    const cleanFname = path.basename(new URL(cleanScaledUrl).pathname);
    const cleanPath  = path.join(UPLOADS_DIR, cleanFname);
    if (!fs.existsSync(cleanPath)) {
      return res.status(404).json({ message: '原始图片不存在，请重新生成' });
    }
    const cleanBuf = fs.readFileSync(cleanPath);

    // 关键：使用 bbox 的实际尺寸，与 compositeResult 保持一致
    const overlayOpts = { genStyle, fanW: bboxW, fanH: bboxH, tplW: tplImg.bitmap.width, tplH: tplImg.bitmap.height };
    console.log(`  [recomposite-text] 收到 textLines 数量: ${textLines ? textLines.length : 0}`);
    if (useNewMode) {
      console.log(`  [recomposite-text] 使用新模式，前端传来的 textLines:`, JSON.stringify(textLines, null, 2));
      overlayOpts.textLines = textLines.map(line => ({
        text:      line.text,
        x:         line.x != null ? Number(line.x) : 0.5,
        y:         line.y != null ? Number(line.y) : 0.5,
        rotation:  line.rotation != null ? Number(line.rotation) : 0,
        fontSize:  line.fontSize != null ? Number(line.fontSize) : null,
        fontFamily: line.fontFamily || null,
        fontWeight: line.fontWeight || null,
        color:      line.color || null,
        maxWidth:   line.maxWidth || null,
        align:      line.align || null,
        style:      line.style || null,
        artStyle:   line.artStyle || null,
        strokeColor: line.strokeColor || null,
        glowColor:  line.glowColor || null,
        colorStops: line.colorStops || null,
      }));
    } else {
      overlayOpts.textCenterFraction = Number(textCenterFraction);
      overlayOpts.textCenterX = textCenterX != null ? Number(textCenterX) : undefined;
      overlayOpts.szMult = szMult != null ? Number(szMult) : undefined;
    }

    const bgStyleMap = { photo: 'festive', chinese: 'elegant', business: 'festive', illustration: 'festive' };
    const bgStyle    = bgStyleMap[genStyle] || 'festive';
    let textedBuf;

    if (useNewMode) {
      // 编辑器模式：先渲染背景，再把前端拖拽好的 textLines 叠加上去
      console.log(`  [recomposite-text] 编辑器模式：渲染背景 + 叠加 ${textLines.length} 行文字`);
      const bgBuf = await renderAdBackground(cleanBuf, bboxW, bboxH, bgStyle);
      ({ buffer: textedBuf } = await overlayMerchantText(bgBuf, merchantInfo, overlayOpts));
    } else {
      // 无 textLines：全自动广告排版
      console.log(`  [recomposite-text] 自动排版模式`);
      const adConfig = {
        companyName:  merchantInfo.shopName   || '',
        headline:     merchantInfo.mainTitle  || '',
        subheadline:  merchantInfo.subTitle   || '',
        subheadlines: merchantInfo.subTitles  || [],
        phone:        merchantInfo.phone      || '',
        address:      merchantInfo.address    || '',
        qrText:       merchantInfo.qrText     || '',
        promoItems:   merchantInfo.promoItems || [],
        bgStyle,
      };
      ({ buffer: textedBuf } = await renderAdPoster(adConfig, cleanBuf, bboxW, bboxH));
    }

    // Overlay user-uploaded image elements (e.g. LOGO)
    const mergedBuf = await overlayImageElements(textedBuf, imageElements, bboxW, bboxH);

    const finalImg = await compositeResult(tplBufOrig, mergedBuf, bbox);
    const { url: finalUrl, cdrUrl } = await saveToUploads(finalImg, req.get('host'));
    console.log(`  ✓ 完成：${finalUrl}`);

    res.json({
      url: finalUrl,
      fanBox: { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
      cdrUrl,
    });
  } catch (err) {
    console.error('  ✗ recomposite-text:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/image/generate-ad-fan
// 混合方案：火山引擎生成氛围背景 + Puppeteer 渲染广告排版 + 合成进扇面模板
// ─────────────────────────────────────────────────────────────────────
const { renderAdPoster, renderAdBackground, AD_BG_PROMPTS } = require('./adPoster');

router.post('/generate-ad-fan', async (req, res) => {
  const { templateUrl, adConfig = {} } = req.body || {};
  const {
    companyName = '', headline = '', subheadline = '',
    promoItems  = [], phone = '', address = '',
    qrText = '', bgStyle = 'festive', logoBase64 = '',
  } = adConfig;

  if (!headline.trim() && !companyName.trim()) {
    return res.status(400).json({ error: '请至少填写公司名称或大标题' });
  }

  try {
    console.log(`\n▶ 广告扇面生成  bgStyle="${bgStyle}"  headline="${headline}"`);

    // 1. 确定扇面尺寸
    let bbW = 1024, bbH = 1024;
    let tplBufOrig = null;
    let bbox       = null;

    if (templateUrl) {
      console.log('  [1/4] 下载模板，识别扇面…');
      const tplBuf = await fetchBuffer(templateUrl);
      const tplImg = await Jimp.read(tplBuf);
      tplBufOrig   = await tplImg.getBufferAsync(Jimp.MIME_PNG);
      bbox         = await findFanBoundingBox(tplBufOrig);
      bbW = bbox.maxX - bbox.minX + 1;
      bbH = bbox.maxY - bbox.minY + 1;
      console.log(`  扇面包围盒：${bbW}×${bbH}`);
    } else {
      console.log('  [1/4] 无模板，使用默��� 1024×1024');
    }

    // 2. 火山引擎生成氛围背景（无文字）
    console.log('  [2/4] 火山引擎生成背景…');
    const bgPrompt = AD_BG_PROMPTS[bgStyle] || AD_BG_PROMPTS.festive;
    const bgUrl    = await volcT2I(bgPrompt, bbW, bbH);
    const bgBuf    = await fetchBuffer(bgUrl);

    // 3. Puppeteer 渲染广告版面
    console.log('  [3/4] Puppeteer 渲染广告排版…');
    const { buffer: adBuf } = await renderAdPoster(
      { companyName, headline, subheadline, promoItems, phone, address, qrText, bgStyle, logoBase64 },
      bgBuf, bbW, bbH
    );

    // 4. 合成进扇面模板（或直接保存）
    let finalImg;
    if (tplBufOrig && bbox) {
      console.log('  [4/4] 合成进扇面模板…');
      finalImg = await compositeResult(tplBufOrig, adBuf, bbox);
    } else {
      console.log('  [4/4] 无模板，直接输出广告图…');
      finalImg = await Jimp.read(adBuf);
    }

    const { url: finalUrl, cdrUrl } = await saveToUploads(finalImg, req.get('host'));
    console.log(`  ✓ 完成：${finalUrl}`);
    res.json({ images: [{ url: finalUrl, cdrUrl }] });

  } catch (err) {
    console.error('  ✗ generate-ad-fan:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
