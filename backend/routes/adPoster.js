/**
 * adPoster.js — 广告海报渲染（@napi-rs/canvas 实现，无需 Chrome/Puppeteer）
 *
 * 导出：
 *   renderAdPoster(config, bgImageBuf, width, height) → Buffer (PNG)
 *   AD_BG_PROMPTS  背景 prompt 映射表
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const QRCode = require('qrcode');

const AD_BG_PROMPTS = {
  festive:  '橙红金色抽象光效背景，散景光斑，放射状光线粒子，无任何文字图案，纯光效纹理',
  business: '深蓝色抽象光效背景，流动光线，蓝色散景光斑，无任何文字图案，纯光效纹理',
  elegant:  '深红棕色抽象光效背景，金色丝绸纹理光斑，无任何文字图案，纯光效纹理',
};

const STYLE_CONFIG = {
  festive: {
    radialInner: '#FF6A00',
    radialOuter: '#5A0800',
    aiAlpha:     0.08,
    overlay:     [[120, 20, 0, 0.25], [60, 5, 0, 0.40]],
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
 * 绘制放射状背景
 */
function drawRadialBackground(ctx, W, H, theme) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.42;
  const r  = Math.max(W, H) * 0.72;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  rg.addColorStop(0,    theme.radialInner);
  rg.addColorStop(0.55, theme.radialOuter);
  rg.addColorStop(1,    '#000000');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  const topG = ctx.createLinearGradient(0, 0, 0, H * 0.25);
  topG.addColorStop(0, 'rgba(0,0,0,0.45)');
  topG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, W, H);
  const botG = ctx.createLinearGradient(0, H * 0.65, 0, H);
  botG.addColorStop(0, 'rgba(0,0,0,0)');
  botG.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = botG;
  ctx.fillRect(0, 0, W, H);
}

/**
 * 绘制中心放射光晕
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
  const depth = Math.round(fontSize * 0.12);
  for (let d = depth; d >= 1; d--) {
    const ratio = d / depth;
    ctx.fillStyle = `rgba(60,10,0,${0.5 + ratio * 0.4})`;
    ctx.fillText(text, x + d, y + d, maxW);
  }
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.round(fontSize * 0.20);
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = Math.round(fontSize * 0.6);
  ctx.strokeText(text, x, y, maxW);
  ctx.strokeText(text, x, y, maxW);
  clearShadow(ctx);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.07));
  ctx.strokeText(text, x, y, maxW);
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
 * 只渲染背景，不加文字（供编辑器使用）
 */
async function renderAdBackground(bgImageBuf, width, height, bgStyle = 'festive') {
  const W = width, H = height;
  const theme = STYLE_CONFIG[bgStyle] || STYLE_CONFIG.festive;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const bgImg = await loadImage(bgImageBuf);
  ctx.drawImage(bgImg, 0, 0, W, H);
  const vigR = Math.max(W, H) * 0.65;
  const vig  = ctx.createRadialGradient(W / 2, H * 0.45, vigR * 0.42, W / 2, H * 0.45, vigR);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.48)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  return canvas.toBuffer('image/png');
}

/**
 * 渲染广告海报（固定位置布局）
 */
async function renderAdPoster(config, bgImageBuf, width, height) {
  const {
    companyName = '', headline = '', subheadline = '',
    subheadlines = [],
    promoItems = [], phone = '', address = '',
    qrText = '', bgStyle = 'festive', logoBase64 = '',
  } = config;
  const allSubheadlines = subheadlines.length > 0 ? subheadlines : (subheadline ? [subheadline] : []);

  const W = width, H = height;
  const theme = STYLE_CONFIG[bgStyle] || STYLE_CONFIG.festive;

  const fs = {
    company:  Math.max(20, Math.round(H * 0.052)),
    headline: Math.max(36, Math.round(H * 0.13)),
    sub:      Math.max(14, Math.round(H * 0.032)),
    promo:    Math.max(13, Math.round(H * 0.030)),
    contact:  Math.max(12, Math.round(H * 0.026)),
  };
  const pad     = Math.round(W * 0.06);
  const usableW = W - pad * 2;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // 1. AI 图作为主背景
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const bgImg = await loadImage(bgImageBuf);
  ctx.drawImage(bgImg, 0, 0, W, H);

  // 2. 边缘暗角
  const vigR = Math.max(W, H) * 0.65;
  const vig  = ctx.createRadialGradient(W / 2, H * 0.45, vigR * 0.42, W / 2, H * 0.45, vigR);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.48)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // 3. 顶部压暗
  const topG = ctx.createLinearGradient(0, 0, 0, H * 0.30);
  topG.addColorStop(0, 'rgba(0,0,0,0.52)');
  topG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, W, H);

  // 4. 底部压暗
  const botG = ctx.createLinearGradient(0, H * 0.62, 0, H);
  botG.addColorStop(0, 'rgba(0,0,0,0)');
  botG.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = botG;
  ctx.fillRect(0, 0, W, H);

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

  const textLayout = [];

  // 固定位置（上移版）
  const shopY       = Math.round(H * 0.10);
  const decorY      = Math.round(H * 0.16);
  const headY       = Math.round(H * 0.26);
  const subStartY   = Math.round(H * 0.36);
  const subDY       = Math.round(H * 0.072);
  const promoX      = Math.round(W * 0.73);
  const promoStartY = Math.round(H * 0.58);
  const promoDY     = Math.round(H * 0.10);
  const phoneY      = Math.round(H * 0.78);
  const addressY    = Math.round(H * 0.85);
  const cntPad      = Math.round(W * 0.15);

  // Zone A：店名（顶部居中）
  if (companyName) {
    textLayout.push({
      text: companyName, x: 0.5, y: shopY / H,
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
    ctx.strokeText(companyName, W / 2, shopY, usableW); clearShadow(ctx);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = Math.max(1, Math.round(fs.company * 0.05));
    ctx.strokeText(companyName, W / 2, shopY, usableW);
    const cg = ctx.createLinearGradient(0, shopY - fs.company / 2, 0, shopY + fs.company / 2);
    theme.companyGrad.forEach((c, i) => cg.addColorStop(i / (theme.companyGrad.length - 1), c));
    ctx.fillStyle = cg;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = Math.round(fs.company * 0.18);
    ctx.shadowOffsetY = Math.round(fs.company * 0.05);
    ctx.fillText(companyName, W / 2, shopY, usableW); clearShadow(ctx);
    ctx.restore();
    drawDivider(decorY);
  }

  // Zone B：主标题（居中，自适应字号）
  if (headline) {
    // 自动缩小字号直到文字宽度适合画布
    let headFontSize = fs.headline;
    ctx.font = `900 ${headFontSize}px "Microsoft YaHei","MSYaHei",sans-serif`;
    while (headFontSize > 24 && ctx.measureText(headline).width > usableW * 0.92) {
      headFontSize -= 4;
      ctx.font = `900 ${headFontSize}px "Microsoft YaHei","MSYaHei",sans-serif`;
    }
    textLayout.push({
      text: headline, x: 0.5, y: headY / H,
      fontSize: headFontSize, fontFamily: 'MSYaHei', fontWeight: '900',
      color: theme.headGrad[1] || '#FFE040', artStyle: 'gradient',
      strokeColor: '#000000', glowColor: theme.accent,
      colorStops: theme.headGrad,
    });
    draw3DHeadline(ctx, headline, W / 2, headY, headFontSize, usableW, theme);
  }

  // Zone B2：副标题（居中，主标题下方）
  const firstSubY = headline ? subStartY : headY;
  allSubheadlines.forEach((sh, i) => {
    if (!sh) return;
    const subY = firstSubY + i * subDY;
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
  });

  // Zone C：促销项目（右侧竖排）
  if (promoItems.length > 0) {
    const items  = promoItems.slice(0, 5);
    const itemH  = Math.round(fs.promo * 2.6);
    const itemW  = Math.round(W * 0.50);
    const badgeR = Math.round(itemH * 0.28);

    items.forEach((item, i) => {
      const iy      = promoStartY + i * promoDY - itemH / 2;
      const badgeCX = promoX - itemW / 2 + badgeR + Math.round(itemW * 0.04);
      const badgeCY = iy + itemH / 2;
      const textX   = badgeCX + badgeR + Math.round(itemW * 0.04);
      const textMaxW = itemW - (textX - (promoX - itemW / 2)) - Math.round(itemW * 0.04);

      textLayout.push({
        text: `${i + 1}. ${item}`, x: promoX / W, y: badgeCY / H,
        fontSize: fs.promo, fontFamily: 'MSYaHei', fontWeight: 'bold',
        color: theme.promoTextColor || 'rgba(255,235,180,0.95)', style: 'promo', artStyle: '',
        strokeColor: theme.accent, glowColor: theme.accent,
      });

      ctx.save();
      ctx.fillStyle = theme.promoCardBg || 'rgba(40,5,0,0.72)';
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(1, Math.round(H * 0.002));
      ctx.beginPath();
      ctx.roundRect(promoX - itemW / 2, iy, itemW, itemH, Math.round(itemH * 0.18));
      ctx.fill(); ctx.stroke();

      const hlG = ctx.createLinearGradient(promoX - itemW / 2, iy, promoX + itemW / 2, iy);
      hlG.addColorStop(0, `${theme.accent}00`);
      hlG.addColorStop(0.5, `${theme.accent}88`);
      hlG.addColorStop(1, `${theme.accent}00`);
      ctx.fillStyle = hlG;
      ctx.fillRect(promoX - itemW / 2 + 3, iy, itemW - 6, Math.round(itemH * 0.07));

      ctx.beginPath(); ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = theme.promoBadgeBg; ctx.fill();
      ctx.strokeStyle = theme.accent; ctx.lineWidth = Math.max(1, Math.round(badgeR * 0.15)); ctx.stroke();
      ctx.font = `bold ${Math.round(badgeR * 1.05)}px "Microsoft YaHei",sans-serif`;
      ctx.fillStyle = theme.promoBadgeFg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), badgeCX, badgeCY);

      ctx.font = `bold ${fs.promo}px "Microsoft YaHei","MSYaHei",sans-serif`;
      ctx.fillStyle = theme.promoTextColor || 'rgba(255,235,180,0.95)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(item, textX, badgeCY, textMaxW);
      ctx.restore();
    });
  }

  // Zone D：联系方式（左侧固定位置）
  ctx.save();
  ctx.font = `normal ${fs.contact}px "Microsoft YaHei","MSYaHei",sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3;

  if (phone) {
    const phoneX = cntPad + Math.round(fs.contact * 1.4);
    textLayout.push({
      text: phone, x: phoneX / W, y: phoneY / H,
      fontSize: fs.contact, fontFamily: 'MSYaHei', fontWeight: 'normal',
      color: theme.textColor, artStyle: '', strokeColor: '#000000', glowColor: theme.accent,
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent; ctx.fillText('\u260E', cntPad, phoneY);
    ctx.fillStyle = theme.textColor; ctx.fillText(phone, phoneX, phoneY, W - cntPad - pad);
  }
  if (address) {
    const addrX = cntPad + Math.round(fs.contact * 1.5);
    textLayout.push({
      text: address, x: addrX / W, y: addressY / H,
      fontSize: fs.contact, fontFamily: 'MSYaHei', fontWeight: 'normal',
      color: theme.textColor, artStyle: '', strokeColor: '#000000', glowColor: theme.accent,
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent; ctx.fillText('\uD83D\uDCCD', cntPad, addressY);
    ctx.fillStyle = theme.textColor; ctx.fillText(address, addrX, addressY, W - cntPad - pad);
  }
  clearShadow(ctx); ctx.restore();

  return { buffer: canvas.toBuffer('image/png'), textLayout };
}

module.exports = { renderAdPoster, renderAdBackground, AD_BG_PROMPTS };
