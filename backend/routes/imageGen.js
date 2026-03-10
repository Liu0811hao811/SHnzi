/**
 * imageGen.js — 火山引擎文生图路由
 *
 * 接口：视觉智能开放平台 CVProcess（文生图）
 *   https://www.volcengine.com/docs/6367/1245922
 *
 * 鉴权：火山引擎 API V4 签名（HMAC-SHA256）
 *   https://www.volcengine.com/docs/6369/67269
 *
 * 密钥配置：在 backend/.env 中设置
 *   VOLC_AK = AccessKeyID
 *   VOLC_SK = SecretAccessKey（base64 编码）
 *
 * 路由：
 *   POST /api/image/generate
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

// ─────────────────────────────────────────────────────────────────────
// 密钥读取（server.js 启动时已加载 .env）
// ─────────────────────────────────────────────────────────────────────
const VOLC_AK = process.env.VOLC_AK || '';
const VOLC_SK = process.env.VOLC_SK || '';

// ─────────────────────────────────────────────────────────────────────
// 火山引擎 V4 签名
// ─────────────────────────────────────────────────────────────────────

/** SHA-256 哈希，返回十六进制字符串 */
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** HMAC-SHA256，key 为 Buffer 或 string，返回 Buffer */
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/** HMAC-SHA256，返回十六进制字符串 */
function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * 构造 Authorization 头
 *
 * @param {string} ak         - AccessKeyID
 * @param {string} sk         - SecretAccessKey（已解码）
 * @param {object} opts
 *   host, service, region, action, version, dateTime, bodyHash
 * @returns {string} Authorization 头的值
 */
function buildAuthorization(ak, sk, { host, service, region, action, version, dateTime, bodyHash }) {
  const date = dateTime.slice(0, 8);  // YYYYMMDD

  // ── Step 1: 规范化请求 ──────────────────────────────────────────
  //
  //   POST\n
  //   /\n
  //   Action=CVProcess&Version=2022-08-31\n
  //   content-type:application/json\n
  //   host:{host}\n
  //   x-date:{dateTime}\n
  //                           ← 空行（规范头与已签名头之间必须有空行）
  //   content-type;host;x-date\n
  //   {bodyHash}
  //
  const queryString   = `Action=${action}&Version=${version}`;
  const signedHeaders = 'content-type;host;x-date';

  const canonicalRequest = [
    'POST',
    '/',
    queryString,
    `content-type:application/json`,
    `host:${host}`,
    `x-date:${dateTime}`,
    '',               // 空行：canonical headers 与 signed headers 之间的分隔
    signedHeaders,
    bodyHash,
  ].join('\n');

  // ── Step 2: 待签字符串 ───────────────────────────────────────────
  const credentialScope = `${date}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    dateTime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // ── Step 3: 派生签名密钥 ─────────────────────────────────────────
  //   kDate    = HMAC-SHA256(SK, Date)
  //   kRegion  = HMAC-SHA256(kDate, Region)
  //   kService = HMAC-SHA256(kRegion, Service)
  //   kSigning = HMAC-SHA256(kService, "request")
  const kDate    = hmac(sk, date);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');

  const signature = hmacHex(kSigning, stringToSign);

  // ── Step 4: 拼装 Authorization ───────────────────────────────────
  return `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * 调用火山引擎 API
 *
 * @param {string} service - 签名用服务名（如 "cv"）
 * @param {string} host    - 实际请求 host（如 "visual.volcengineapi.com"）
 * @param {string} region  - 地域（如 "cn-north-1"）
 * @param {string} action  - 接口名（如 "CVProcess"）
 * @param {string} version - 接口版本（如 "2022-08-31"）
 * @param {object} body    - 请求体
 * @returns {{ status: number, data: object }}
 */
async function volcRequest({ service, host, region, action, version, body }) {
  const bodyStr  = JSON.stringify(body);
  const bodyHash = sha256Hex(bodyStr);

  // 生成请求时间戳（格式：20240101T120000Z）
  const now      = new Date();
  const dateTime = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  const authorization = buildAuthorization(VOLC_AK, VOLC_SK, {
    host, service, region, action, version, dateTime, bodyHash,
  });

  const response = await fetch(
    `https://${host}/?Action=${action}&Version=${version}`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Date':        dateTime,
        'Authorization': authorization,
        // 注意：不要显式设置 Host，fetch 会根据 URL 自动添加
      },
      body: bodyStr,
    }
  );

  const text = await response.text();
  console.log('[VolcEngine] status:', response.status);
  console.log('[VolcEngine] body:', text);
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { httpStatus: response.status, data };
}

// ─────────────────────────────────────────────────────────────────────
// 模型配置
// ─────────────────────────────────────────────────────────────────────

/**
 * 根据质量参数选择模型 req_key
 * 如接口报"model not found"，可前往控制台查看已开通模型名称
 */
function getReqKey(quality) {
  return 'high_aes_general_v30l_zt2i'; // 已开通模型
}

// ─────────────────────────────────────────────────────────────────────
// 路由
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/image/generate
 *
 * Body: {
 *   prompt   : string  — 提示词（必填）
 *   size     : string  — "1024x1024" | "1792x1024" | "1024x1792"
 *   quality  : string  — "standard" | "hd"
 * }
 *
 * 响应（与 OpenAI 格式兼容，前端无需改动）：
 *   { images: [{ url, revised_prompt }] }
 */
router.post('/generate', async (req, res) => {
  const { prompt, size = '1024x1024', quality = 'standard' } = req.body;

  // 参数校验
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ message: '请输入提示词' });
  }

  // 密钥检查
  if (!VOLC_AK || !VOLC_SK) {
    return res.status(500).json({
      message: '未配置火山引擎密钥，请检查 backend/.env 中的 VOLC_AK / VOLC_SK',
    });
  }

  // 解析尺寸（"1024x1024" → width=1024, height=1024）
  const [width, height] = size.split('x').map(Number);
  if (!width || !height) {
    return res.status(400).json({ message: `不支持的尺寸格式：${size}` });
  }

  try {
    const { httpStatus, data } = await volcRequest({
      service: 'cv',                        // V4 签名 credential scope 中的服务标识
      host:    'visual.volcengineapi.com',  // 实际请求的 host（与签名 service 不同）
      region:  'cn-north-1',
      action:  'CVProcess',
      version: '2022-08-31',
      body: {
        req_key:    getReqKey(quality),
        prompt:     prompt.trim(),
        width,
        height,
        use_sr:     true,            // 超分辨率增强
        return_url: true,            // 返回图片 URL（而非 base64）
        logo_info:  { add_logo: false },
      },
    });

    // 鉴权 / 路由层错误（ResponseMetadata.Error 格式，如 SignatureDoesNotMatch）
    if (data.ResponseMetadata?.Error) {
      const e = data.ResponseMetadata.Error;
      return res.status(httpStatus || 500).json({
        message: `${e.Code}: ${e.Message}`,
      });
    }

    // 业务层错误（HTTP 200 但 code != 10000）
    if (data.code !== 10000) {
      return res.status(httpStatus || 500).json({
        message: data.message || `生成失败（code: ${data.code}）`,
      });
    }

    // 图片数据：优先使用 URL，退降到 base64
    let images = [];

    if (data.data?.image_urls?.length) {
      // 返回了图片 URL（通常 1 小时内有效）
      images = data.data.image_urls.map(url => ({ url, revised_prompt: null }));
    } else if (data.data?.binary_data_base64?.length) {
      // 返回了 base64，转为 data URL 直接展示
      images = data.data.binary_data_base64.map(b64 => ({
        url:            `data:image/jpeg;base64,${b64}`,
        revised_prompt: null,
      }));
    }

    if (!images.length) {
      return res.status(500).json({ message: '接口未返回图片数据' });
    }

    res.json({ images });

  } catch (err) {
    res.status(500).json({ message: `请求失败：${err.message}` });
  }
});

module.exports = router;
