/**
 * adPoster.js — 广告海报渲染（@napi-rs/canvas 实现，无需 Chrome/Puppeteer）
 *
 * 导出：
 *   renderAdPoster(config, bgImageBuf, width, height) → Buffer (PNG)
 *   AD_BG_PROMPTS  背景 prompt 映射表
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const QRCode = require('qrcode');

// ── 背景风格 → 火山引擎 prompt（生成抽象光效纹理，作为叠加纹理使用）──
const AD_BG_PROMPTS = {
  festive:  '橙红金色抽象光效背景，散景光斑，放射状光线粒子，无任何文字图案，纯光效纹理',
  business: '深蓝色抽象光效背景，流动光线，蓝色散景光斑，无任何文字图案，纯光效纹理',
  elegant:  '深红棕色抽象光效背景，金色丝绸纹理光斑，无任何文字图案，纯光效纹理',
};

// ── 风格主题色配置 ──────────────────────────────────────────────────
const STYLE_CONFIG = {
  festive: {
    // 放射状底色：中心亮橙，四周深红
    radialInner: '#FF6A00',
    radialOuter: '#5A0800',
    // AI 纹理叠加透明度（极低，避免写实产品图干扰背景）
    aiAlpha:     0.08,
    // 遮罩（轻薄，让背景透出来）
    overlay:     [[120, 20, 0, 0.25], [60, 5, 0, 0.40]],
    // 金色光晕（中心放射）
    glowColor:   'rgba(255,200,50,0.18)',
    accent:      '#FFD700',
    headGrad:    ['#FFFBE0', '#FFE040', '#FF8010', '#CC3000'],
    companyGrad: ['#FFE840', '#FF7020', '#FFB030'],
    textColor:   'rgba(255,240,180,0.95)',
    divider:     'rgba(255,210,70,0.65)',
    promoBadgeBg:'rgba(200,50,0,0.75)',
    promoBadgeFg:'#FFE840',
    promoTextColor:'rgba(255,240,200,0.95)',
    promoCardBg: 'rgba(50,5,0,0.72)',
  },
  business: {
    radialInner: '#0040C0',
    radialOuter: '#000820',
    aiAlpha:     0.08,
    overlay:     [[0, 10, 70, 0.25], [0, 3, 40, 0.40]],
    glowColor:   'rgba(60,140,255,0.18)',
    accent:      '#60AAFF',
    headGrad:    ['#FFFFFF', '#A0D0FF', '#4080E0', '#0030A0'],
    companyGrad: ['#FFFFFF', '#80C0FF', '#2060D0'],
    textColor:   'rgba(200,225,255,0.95)',
    divider:     'rgba(80,160,255,0.65)',
    promoBadgeBg:'rgba(0,50,160,0.75)',
    promoBadgeFg:'#FFFFFF',
    promoTextColor:'rgba(200,225,255,0.95)',
    promoCardBg: 'rgba(0,8,50,0.72)',
  },
  elegant: {
    radialInner: '#A02010',
    radialOuter: '#200005',
    aiAlpha:     0.08,
    overlay:     [[50, 0, 5, 0.25], [25, 0, 2, 0.40]],
    glowColor:   'rgba(230,180,60,0.18)',
    accent:      '#E8B860',
    headGrad:    ['#FFFBE0', '#F0D080', '#C08020', '#804000'],
    companyGrad: ['#FFE8A0', '#D09030', '#A06010'],
    textColor:   'rgba(255,235,190,0.95)',
    divider:     'rgba(210,165,60,0.65)',
    promoBadgeBg:'rgba(120,20,0,0.75)',
    promoBadgeFg:'#FFE8A0',
    promoTextColor:'rgba(255,235,190,0.95)',
    promoCardBg: 'rgba(35,5,0,0.72)',
  },
};

function clearShadow(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
}

/**
 * 绘制放射状背景（中心亮、四周深）
 */
function drawRadialBackground(ctx, W, H, theme) {
  // 1. 纯黑打底防透明
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // 2. 放射状渐变底色
  const cx = W / 2, cy = H * 0.42;
  const r  = Math.max(W, H) * 0.72;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  rg.addColorStop(0,    theme.radialInner);
  rg.addColorStop(0.55, theme.radialOuter);
  rg.addColorStop(1,    '#000000');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  // 3. 顶部向下的深色压角（让顶部不过亮）
  const topG = ctx.createLinearGradient(0, 0, 0, H * 0.25);
  topG.addColorStop(0, 'rgba(0,0,0,0.45)');
  topG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, W, H);

  // 4. 底部向上的深色压角（让底部有厚重感）
  const botG = ctx.createLinearGradient(0, H * 0.65, 0, H);
  botG.addColorStop(0, 'rgba(0,0,0,0)');
  botG.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = botG;
  ctx.fillRect(0, 0, W, H);
}

/**
 * 绘制中心放射金色光晕
 */
function drawGlowBurst(ctx, W, H, theme) {
  const cx = W / 2, cy = H * 0.40;
  const r  = Math.max(W, H) * 0.55;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  rg.addColorStop(0,   theme.glowColor);
  rg.addColorStop(0.4, theme.glowColor);
  rg.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * 绘制 3D 挤出效果标题文字
 */
function draw3DHeadline(ctx, text, x, y, fontSize, maxW, theme) {
  ctx.save();
  ctx.font = `900 ${fontSize}px "Microsoft YaHei","MSYaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // 3D 挤出层（向右下偏移，产生厚度感）
  const depth = Math.round(fontSize * 0.12);
  for (let d = depth; d >= 1; d--) {
    const ratio = d / depth;
    ctx.fillStyle = `rgba(60,10,0,${0.5 + ratio * 0.4})`;
    ctx.fillText(text, x + d, y + d, maxW);
  }

  // 外发光描边
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.round(fontSize * 0.20);
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = Math.round(fontSize * 0.6);
  ctx.strokeText(text, x, y, maxW);
  ctx.strokeText(text, x, y, maxW);
  clearShadow(ctx);

  // 深色轮廓描边
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.07));
  ctx.strokeText(text, x, y, maxW);

  // 金属渐变填充
  const hg = ctx.createLinearGradient(x - maxW / 2, y - fontSize * 0.6, x + maxW / 2, y + fontSize * 0.6);
  theme.headGrad.forEach((c, i) => hg.addColorStop(i / (theme.headGrad.length - 1), c));
  ctx.fillStyle = hg;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = Math.round(fontSize * 0.15);
  ctx.shadowOffsetY = Math.round(fontSize * 0.05);
  ctx.fillText(text, x, y, maxW);
  clearShadow(ctx);

  ctx.restore();
}

/**
 * 只渲染背景（渐变 + AI纹理 + 光晕），不加任何文字
 * 供"编辑文字"功能使用：将此背景展示在编辑器中，文字由前端拖拽叠加
 */
async function renderAdBackground(bgImageBuf, width, height, bgStyle = 'festive') {
  const W = width, H = height;
  const theme = STYLE_CONFIG[bgStyle] || STYLE_CONFIG.festive;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // AI 图作为主背景
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const bgImg = await loadImage(bgImageBuf);
  ctx.drawImage(bgImg, 0, 0, W, H);

  // 边缘暗角
  const vigR = Math.max(W, H) * 0.65;
  const vig  = ctx.createRadialGradient(W / 2, H * 0.45, vigR * 0.42, W / 2, H * 0.45, vigR);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.48)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  return canvas.toBuffer('image/png');
}

/**
 * 渲染广告海报
 */
async function renderAdPoster(config, bgImageBuf, width, height) {
  const {
    companyName = '', headline = '', subheadline = '',
    subheadlines = [],
    promoItems = [], phone = '', address = '',
    qrText = '', bgStyle = 'festive', logoBase64 = '',
  } = config;
  // 支持多条副标题；兼容旧 subheadline 单字段
  const allSubheadlines = subheadlines.length > 0 ? subheadlines : (subheadline ? [subheadline] : []);

  const W = width, H = height;
  const theme = STYLE_CONFIG[bgStyle] || STYLE_CONFIG.festive;

  // ── 字号（按高度比例）──
  const fs = {
    company:  Math.max(20, Math.round(H * 0.052)),
    headline: Math.max(36, Math.round(H * 0.13)),   // 大幅提升标题字号
    sub:      Math.max(14, Math.round(H * 0.032)),
    promo:    Math.max(13, Math.round(H * 0.030)),
    contact:  Math.max(12, Math.round(H * 0.026)),
  };
  const pad     = Math.round(W * 0.06);
  const usableW = W - pad * 2;
  const qrSize  = Math.round(Math.min(W, H) * 0.18);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── 1. AI 图作为主背景（用户 prompt 决定颜色）────────────────────
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const bgImg = await loadImage(bgImageBuf);
  ctx.drawImage(bgImg, 0, 0, W, H);

  // ── 2. 边缘暗角（让扇面裁切更自然）──────────────────────────────
  const vigR = Math.max(W, H) * 0.65;
  const vig  = ctx.createRadialGradient(W / 2, H * 0.45, vigR * 0.42, W / 2, H * 0.45, vigR);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.48)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── 3. 顶部压暗（文字区域可读）───────────────────────────────────
  const topG = ctx.createLinearGradient(0, 0, 0, H * 0.30);
  topG.addColorStop(0, 'rgba(0,0,0,0.52)');
  topG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, W, H);

  // ── 4. 底部压暗（联系方式可读）───────────────────────────────────
  const botG = ctx.createLinearGradient(0, H * 0.62, 0, H);
  botG.addColorStop(0, 'rgba(0,0,0,0)');
  botG.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = botG;
  ctx.fillRect(0, 0, W, H);

  // ── 分割线工具 ──────────────────────────────────────────────────────
  const zoneGap = Math.round(H * 0.016);
  let curY = Math.round(H * 0.036);

  const drawDivider = (y) => {
    ctx.save();
    const dg = ctx.createLinearGradient(pad, y, W - pad, y);
    dg.addColorStop(0,   'transparent');
    dg.addColorStop(0.2, theme.divider);
    dg.addColorStop(0.8, theme.divider);
    dg.addColorStop(1,   'transparent');
    ctx.strokeStyle = dg;
    ctx.lineWidth = Math.max(1, Math.round(H * 0.0015));
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    ctx.restore();
  };

  // ── 记录每个文字元素的精确坐标，供编辑器初始化用 ──────────────────
  const textLayout = [];

  // ── Zone A：公司名 ────────────────────────────────────────────────
  const zoneAH = Math.round(H * 0.11);
  if (companyName) {
    const cy_ = curY + zoneAH / 2;
    textLayout.push({
      text: companyName, x: 0.5, y: cy_ / H,
      fontSize: fs.company, fontFamily: 'MSYaHei', fontWeight: 'bold',
      color: theme.companyGrad[0], artStyle: 'gradient',
      strokeColor: '#000000', glowColor: theme.accent,
      colorStops: theme.companyGrad,
    });

    ctx.save();
    ctx.font = `bold ${fs.company}px "Microsoft YaHei","MSYaHei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = theme.accent; ctx.lineWidth = Math.round(fs.company * 0.18);
    ctx.shadowColor = theme.accent; ctx.shadowBlur = Math.round(fs.company * 0.5);
    ctx.strokeText(companyName, W / 2, cy_, usableW); clearShadow(ctx);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = Math.max(1, Math.round(fs.company * 0.05));
    ctx.strokeText(companyName, W / 2, cy_, usableW);
    const cg = ctx.createLinearGradient(0, curY, 0, curY + zoneAH);
    theme.companyGrad.forEach((c, i) => cg.addColorStop(i / (theme.companyGrad.length - 1), c));
    ctx.fillStyle = cg;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = Math.round(fs.company * 0.18);
    ctx.shadowOffsetY = Math.round(fs.company * 0.05);
    ctx.fillText(companyName, W / 2, cy_, usableW); clearShadow(ctx);
    ctx.restore();
  }
  curY += zoneAH; drawDivider(curY); curY += zoneGap;

  // ── Zone B：3D 大标题 ─────────────────────────────────────────────
  if (headline) {
    const headY = curY + fs.headline * 0.65;
    textLayout.push({
      text: headline, x: 0.5, y: headY / H,
      fontSize: fs.headline, fontFamily: 'MSYaHei', fontWeight: '900',
      color: theme.headGrad[1] || '#FFE040', artStyle: 'gradient',
      strokeColor: '#000000', glowColor: theme.accent,
      colorStops: theme.headGrad,
    });
    draw3DHeadline(ctx, headline, W / 2, headY, fs.headline, usableW, theme);
    curY += Math.round(fs.headline * 1.4);
  }

  // ── Zone B2：副标题（支持多条）────────────────────────────────────
  allSubheadlines.forEach(sh => {
    if (!sh) return;
    const subY = curY + fs.sub * 0.55;
    textLayout.push({
      text: sh, x: 0.5, y: subY / H,
      fontSize: fs.sub, fontFamily: 'MSYaHei', fontWeight: 'normal',
      color: theme.textColor, artStyle: '',
      strokeColor: '#000000', glowColor: theme.accent,
    });
    ctx.save();
    ctx.font = `normal ${fs.sub}px "Microsoft YaHei","MSYaHei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.textColor;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 5;
    ctx.fillText(sh, W / 2, subY, usableW); clearShadow(ctx);
    ctx.restore();
    curY += Math.round(fs.sub * 1.5);
  });

  // ── Zone C：促销项目（��列紧凑布局）─────────────────────────────
  if (promoItems.length > 0) {
    curY += Math.round(zoneGap * 0.6); drawDivider(curY); curY += zoneGap;

    const items    = promoItems.slice(0, 8);
    const n        = items.length;
    const itemGapX = Math.round(W * 0.012);
    const itemW    = Math.floor((usableW - itemGapX * (n - 1)) / n);
    const itemH    = Math.round(fs.promo * 2.6);
    const badgeR   = Math.round(itemH * 0.28);
    const rowY     = curY;

    for (let i = 0; i < n; i++) {
      const ix      = pad + i * (itemW + itemGapX);
      const iy      = rowY;
      const badgeCX = ix + badgeR + Math.round(itemW * 0.06);
      const badgeCY = iy + itemH / 2;
      const textX   = badgeCX + badgeR + Math.round(itemW * 0.05);
      const textMaxW = itemW - (textX - ix) - Math.round(itemW * 0.04);

      textLayout.push({
        text: `${i + 1}. ${items[i]}`, x: (ix + itemW / 2) / W, y: badgeCY / H,
        fontSize: fs.promo, fontFamily: 'MSYaHei', fontWeight: 'bold',
        color: theme.promoTextColor || 'rgba(255,235,180,0.95)', style: 'promo', artStyle: '',
        strokeColor: theme.accent, glowColor: theme.accent,
      });

      ctx.save();
      // 深色半透明背景盒子（配合扇面深色背景，去掉刺眼白带）
      ctx.fillStyle = theme.promoCardBg || 'rgba(40,5,0,0.72)';
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(1, Math.round(H * 0.002));
      ctx.beginPath(); ctx.roundRect(ix, iy, itemW, itemH, Math.round(itemH * 0.18)); ctx.fill(); ctx.stroke();

      // 顶部高光条
      const hlG = ctx.createLinearGradient(ix, iy, ix + itemW, iy);
      hlG.addColorStop(0, `${theme.accent}00`);
      hlG.addColorStop(0.5, `${theme.accent}88`);
      hlG.addColorStop(1, `${theme.accent}00`);
      ctx.fillStyle = hlG;
      ctx.fillRect(ix + 4, iy, itemW - 8, Math.round(itemH * 0.07));

      // 圆形序号徽章
      ctx.beginPath(); ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = theme.promoBadgeBg; ctx.fill();
      ctx.strokeStyle = theme.accent; ctx.lineWidth = Math.max(1, Math.round(badgeR * 0.15)); ctx.stroke();
      ctx.font = `bold ${Math.round(badgeR * 1.05)}px "Microsoft YaHei",sans-serif`;
      ctx.fillStyle = theme.promoBadgeFg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), badgeCX, badgeCY);

      // 促销文字（亮色，深底上可读）
      ctx.font = `bold ${fs.promo}px "Microsoft YaHei","MSYaHei",sans-serif`;
      ctx.fillStyle = theme.promoTextColor || 'rgba(255,235,180,0.95)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(items[i], textX, badgeCY, textMaxW);
      ctx.restore();
    }

    curY += itemH;
  }

  // ── Zone D：二维码 + 联系方式 ─────────────────────────────────────
  if (phone || address || qrText) {
    curY += Math.round(zoneGap * 0.6); drawDivider(curY); curY += zoneGap;

    let qrImg = null;
    if (qrText.trim()) {
      try {
        const qrBuf = await QRCode.toBuffer(qrText.trim(), {
          width: qrSize, margin: 1, color: { dark: '#1A1A1A', light: '#FFFFFF' },
        });
        qrImg = await loadImage(qrBuf);
      } catch (e) { /* 二维码生成失败则跳过 */ }
    }

    const contactX = qrImg ? pad + qrSize + Math.round(W * 0.04) : pad;
    const contactW = qrImg ? usableW - qrSize - Math.round(W * 0.04) : usableW;
    const lineH    = Math.round(fs.contact * 1.75);

    if (qrImg) {
      ctx.save();
      ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = `${theme.accent}88`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(pad, curY, qrSize, qrSize, 5); ctx.fill(); ctx.stroke();
      ctx.drawImage(qrImg, pad + 3, curY + 3, qrSize - 6, qrSize - 6);
      ctx.restore();
    }

    const contactMidY   = qrImg ? curY + qrSize / 2 : curY + lineH;
    const contactStartY = qrImg
      ? contactMidY - ((phone ? 1 : 0) + (address ? 1 : 0)) * lineH / 2
      : curY;

    ctx.save();
    ctx.font = `normal ${fs.contact}px "Microsoft YaHei","MSYaHei",sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.textColor;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3;

    let cy = contactStartY;
    if (phone) {
      const phoneX = contactX + Math.round(fs.contact * 1.4);
      textLayout.push({
        text: phone, x: (phoneX + contactW / 2) / W, y: (cy + lineH / 2) / H,
        fontSize: fs.contact, fontFamily: 'MSYaHei', fontWeight: 'normal',
        color: theme.textColor, artStyle: '', strokeColor: '#000000', glowColor: theme.accent,
      });
      ctx.fillStyle = theme.accent; ctx.fillText('☎', contactX, cy + lineH / 2);
      ctx.fillStyle = theme.textColor; ctx.fillText(phone, phoneX, cy + lineH / 2, contactW);
      cy += lineH;
    }
    if (address) {
      const addrX = contactX + Math.round(fs.contact * 1.5);
      textLayout.push({
        text: address, x: (addrX + contactW / 2) / W, y: (cy + lineH / 2) / H,
        fontSize: fs.contact, fontFamily: 'MSYaHei', fontWeight: 'normal',
        color: theme.textColor, artStyle: '', strokeColor: '#000000', glowColor: theme.accent,
      });
      ctx.fillStyle = theme.accent; ctx.fillText('📍', contactX, cy + lineH / 2);
      ctx.fillStyle = theme.textColor; ctx.fillText(address, addrX, cy + lineH / 2, contactW);
      cy += lineH;
    }
    clearShadow(ctx); ctx.restore();
  }

  return { buffer: canvas.toBuffer('image/png'), textLayout };
}

module.exports = { renderAdPoster, renderAdBackground, AD_BG_PROMPTS };
