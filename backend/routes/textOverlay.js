/**
 * textOverlay.js — 在 AI 图上叠加商家信息文字
 *
 * 设计亮点：
 *  - GlobalFonts.registerFromPath 显式注册楷体/仿宋，确保风格字体真正生效
 *  - 各风格独立字体 + 字重：chinese=楷体粗体 / photo=仿宋中等 / 其余=雅黑
 *  - 三层渲染：宽色光晕 → 细对比描边 → 彩色填充+投影
 *  - 店名专属加强发光，层次更突出
 *  - 五种风格配色 + 专属装饰分割线 + 整体块框线
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');

// ── 显式注册系统字体（解决 @napi-rs/canvas 无法自动发现系统字体的问题）──
const FONT_REGS = [
  { file: 'C:\\Windows\\Fonts\\simkai.ttf',  family: 'KaiTi'   },   // 楷体
  { file: 'C:\\Windows\\Fonts\\simfang.ttf', family: 'FangSong' },  // 仿宋
  { file: 'C:\\Windows\\Fonts\\simsun.ttc',  family: 'SimSun'   },  // 宋体
  { file: 'C:\\Windows\\Fonts\\msyh.ttc',    family: 'MSYaHei'  },  // 微软雅黑
  { file: 'C:\\Windows\\Fonts\\msyhbd.ttc',  family: 'MSYaHei'  },  // 微软雅黑粗体
];
FONT_REGS.forEach(({ file, family }) => {
  if (fs.existsSync(file)) {
    try { GlobalFonts.registerFromPath(file, family); } catch (e) { /* 已注册则跳过 */ }
  }
});

function hasContent(info) {
  if (!info) return false;
  return Object.values(info).some(v => v && v.trim());
}

// ── 风格配色 + 字体 + 字重表 ─────────────────────────────────────────────
const STYLE_PALETTES = {

  // 中国水墨：楷体粗体 / 朱砂红×金 / 双线菱形群
  chinese: {
    fontFamily:  '"KaiTi", "楷体", "FangSong", "仿宋", "MSYaHei", sans-serif',
    shopWeight:  'bold',
    mainWeight:  'bold',
    subWeight:   'normal',
    cntWeight:   'normal',
    shopGrad:    ['#FFEEB0', '#FF7020', '#FFB030', '#CC1800'],
    mainColor:   '#FFF3D0',
    subColor:    '#FFD090',
    contactColor:'rgba(255,240,200,0.92)',
    outerGlow:   'rgba(220,50,0,0.75)',
    innerGlow:   'rgba(240,110,0,0.52)',
    strokeColor: 'rgba(50,5,0,0.88)',
    dropShadow:  'rgba(120,20,0,0.62)',
    lineColor:   'rgba(228,148,20,0.92)',
    diamondColor:'#E8901C',
    accentColor: '#FF5500',
    decorStyle:  'chinese',
  },

  // 插画设计：雅黑粗体 / 彩虹渐变×马卡龙 / 彩色圆点
  illustration: {
    fontFamily:  '"MSYaHei", "Microsoft YaHei", sans-serif',
    shopWeight:  '900',
    mainWeight:  'bold',
    subWeight:   'normal',
    cntWeight:   'normal',
    shopGrad:    ['#FFE040', '#FF6040', '#CC40C0', '#40A0FF'],
    mainColor:   '#FFF0E8',
    subColor:    '#FFB8A8',
    contactColor:'rgba(255,240,230,0.92)',
    outerGlow:   'rgba(200,50,200,0.75)',
    innerGlow:   'rgba(220,70,160,0.52)',
    strokeColor: 'rgba(50,0,70,0.82)',
    dropShadow:  'rgba(120,20,120,0.58)',
    lineColor:   'rgba(185,80,225,0.90)',
    diamondColor:'#E060FF',
    accentColor: '#FF6040',
    decorStyle:  'dots',
  },

  // 写实摄影：仿宋中等字重 / 银白光泽 / 极简空心菱形
  photo: {
    fontFamily:  '"FangSong", "仿宋", "SimSun", "宋体", "MSYaHei", serif',
    shopWeight:  '500',
    mainWeight:  '400',
    subWeight:   '300',
    cntWeight:   '300',
    shopGrad:    ['#FFFFFF', '#C8C8C8', '#F8F8F8', '#909090'],
    mainColor:   '#FFFFFF',
    subColor:    '#DEDEDE',
    contactColor:'rgba(255,255,255,0.88)',
    outerGlow:   'rgba(0,0,0,0.75)',
    innerGlow:   'rgba(20,20,20,0.48)',
    strokeColor: 'rgba(0,0,0,0.88)',
    dropShadow:  'rgba(0,0,0,0.62)',
    lineColor:   'rgba(185,185,185,0.85)',
    diamondColor:'#C0C0C0',
    accentColor: '#FFFFFF',
    decorStyle:  'minimal',
  },

  // 简约商务：雅黑中等 / 商务蓝渐变 / 圆点现代线
  business: {
    fontFamily:  '"MSYaHei", "Microsoft YaHei", sans-serif',
    shopWeight:  'bold',
    mainWeight:  '500',
    subWeight:   '400',
    cntWeight:   '300',
    shopGrad:    ['#FFFFFF', '#60A8E0', '#1060C0', '#002880'],
    mainColor:   '#EEF8FF',
    subColor:    '#88C4E8',
    contactColor:'rgba(210,235,255,0.92)',
    outerGlow:   'rgba(0,50,200,0.72)',
    innerGlow:   'rgba(10,80,220,0.52)',
    strokeColor: 'rgba(0,10,70,0.88)',
    dropShadow:  'rgba(0,20,130,0.62)',
    lineColor:   'rgba(30,120,230,0.90)',
    diamondColor:'#2080D0',
    accentColor: '#60C0FF',
    decorStyle:  'modern',
  },

  // 默认：雅黑粗体 / 经典金色 / 传统菱形横线
  default: {
    fontFamily:  '"MSYaHei", "Microsoft YaHei", "PingFang SC", sans-serif',
    shopWeight:  'bold',
    mainWeight:  'bold',
    subWeight:   'normal',
    cntWeight:   'normal',
    shopGrad:    ['#FFFFF0', '#FFE840', '#FFD700', '#A07000'],
    mainColor:   '#FFFAF0',
    subColor:    '#FFE898',
    contactColor:'rgba(255,252,230,0.92)',
    outerGlow:   'rgba(190,120,0,0.72)',
    innerGlow:   'rgba(210,150,0,0.52)',
    strokeColor: 'rgba(55,25,0,0.88)',
    dropShadow:  'rgba(90,55,0,0.58)',
    lineColor:   'rgba(240,200,0,0.90)',
    diamondColor:'#FFD700',
    accentColor: '#FFF080',
    decorStyle:  'classic',
  },
};

/**
 * 在图片上叠加商家信息文字
 */
async function overlayMerchantText(imageBuf, merchantInfo, fanInfo = {}) {
  if (!hasContent(merchantInfo)) return imageBuf;

  const { shopName = '', mainTitle = '', subTitle = '', phone = '', address = '' } = merchantInfo;
  const rawStyle = (fanInfo.genStyle || 'default').toLowerCase();
  const palette  = STYLE_PALETTES[rawStyle] || STYLE_PALETTES.default;

  // 取字体名称首项做日志显示
  const fontLabel = palette.fontFamily.split(',')[0].replace(/"/g, '').trim();
  console.log(`  [textOverlay] 风格="${rawStyle}"  字体="${fontLabel}"  字重(店名)="${palette.shopWeight}"`);

  const img = await loadImage(imageBuf);
  const W = img.width;
  const H = img.height;

  const ratio = W / H;
  let safeTop, safeBottom, maxWRatio;
  if (ratio <= 0.9) {
    safeTop = 0.22; safeBottom = 0.70; maxWRatio = 0.75;
  } else if (ratio >= 1.4) {
    safeTop = 0.18; safeBottom = 0.65; maxWRatio = 0.80;
  } else {
    safeTop = 0.20; safeBottom = 0.68; maxWRatio = 0.78;
  }

  const safeStartY = Math.round(H * safeTop);
  const safeEndY   = Math.round(H * safeBottom);
  const safeH      = safeEndY - safeStartY;
  const maxW       = Math.round(W * maxWRatio);
  const cx         = W / 2;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  function clearShadow() {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  }

  /**
   * 三层文字渲染
   *   L1: 宽描边 + 风格色大光晕（绘制两遍增强亮度）
   *   L2: 细描边 + 轻内光晕
   *   L3: 渐变/实色填充 + 投影
   */
  function drawStyledText(text, y, fontSize, fontWeight, fillStyle, isShopName) {
    if (!text) return;
    ctx.font         = `${fontWeight} ${fontSize}px ${palette.fontFamily}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin     = 'round';

    const sw       = Math.max(1, Math.round(fontSize * 0.09));
    const glowBlur = isShopName ? fontSize * 0.65 : fontSize * 0.38;
    const glowW    = isShopName ? sw * 3.5 : sw * 2.5;

    // L1
    ctx.strokeStyle = palette.outerGlow;
    ctx.lineWidth   = glowW;
    ctx.shadowColor = palette.outerGlow;
    ctx.shadowBlur  = glowBlur;
    ctx.strokeText(text, cx, y, maxW);
    ctx.strokeText(text, cx, y, maxW); // 二遍叠加增亮
    clearShadow();

    // L2
    ctx.strokeStyle = palette.strokeColor;
    ctx.lineWidth   = Math.max(1, sw * 0.7);
    ctx.shadowColor = palette.innerGlow;
    ctx.shadowBlur  = fontSize * 0.12;
    ctx.strokeText(text, cx, y, maxW);
    clearShadow();

    // L3
    ctx.fillStyle     = fillStyle;
    ctx.shadowColor   = palette.dropShadow;
    ctx.shadowBlur    = fontSize * 0.16;
    ctx.shadowOffsetX = Math.round(fontSize * 0.02);
    ctx.shadowOffsetY = Math.round(fontSize * 0.06);
    ctx.fillText(text, cx, y, maxW);
    clearShadow();
  }

  function makeGrad(y, h, colors) {
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
    return g;
  }

  function drawBlockBorder(topY, bottomY, width) {
    const lh = Math.max(1, Math.round(H * 0.002));
    ctx.strokeStyle = palette.lineColor;
    ctx.lineWidth   = lh;
    ctx.shadowColor = palette.dropShadow;
    ctx.shadowBlur  = 4;
    ctx.beginPath(); ctx.moveTo(cx - width / 2, topY);    ctx.lineTo(cx + width / 2, topY);    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - width / 2, bottomY); ctx.lineTo(cx + width / 2, bottomY); ctx.stroke();
    clearShadow();
  }

  function drawDecorLine(y, lineW) {
    const lh    = Math.max(1, Math.round(H * 0.0024));
    const dSize = Math.round(lh * 4.5);
    ctx.shadowColor = palette.dropShadow;
    ctx.shadowBlur  = 5;

    switch (palette.decorStyle) {

      case 'chinese': {
        const gap    = dSize * 3.2;
        const offset = lh * 1.4;
        ctx.strokeStyle = palette.lineColor;
        ctx.lineWidth   = lh;
        [[cx - lineW / 2, cx - gap], [cx + gap, cx + lineW / 2]].forEach(([x1, x2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y - offset); ctx.lineTo(x2, y - offset); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x1, y + offset); ctx.lineTo(x2, y + offset); ctx.stroke();
        });
        ctx.fillStyle = palette.diamondColor;
        ctx.beginPath();
        ctx.moveTo(cx, y - dSize); ctx.lineTo(cx + dSize, y);
        ctx.lineTo(cx, y + dSize); ctx.lineTo(cx - dSize, y);
        ctx.closePath(); ctx.fill();
        const sr = dSize * 0.52;
        [cx - gap, cx - gap * 0.48, cx + gap * 0.48, cx + gap].forEach((dx, idx) => {
          ctx.fillStyle = (idx === 1 || idx === 2) ? palette.accentColor : palette.lineColor;
          ctx.beginPath();
          ctx.moveTo(dx, y - sr); ctx.lineTo(dx + sr, y);
          ctx.lineTo(dx, y + sr); ctx.lineTo(dx - sr, y);
          ctx.closePath(); ctx.fill();
        });
        break;
      }

      case 'dots': {
        const halfW = lineW * 0.48;
        const grad  = ctx.createLinearGradient(cx - halfW, y, cx + halfW, y);
        grad.addColorStop(0, 'transparent'); grad.addColorStop(0.15, palette.lineColor);
        grad.addColorStop(0.85, palette.lineColor); grad.addColorStop(1, 'transparent');
        ctx.strokeStyle = grad; ctx.lineWidth = lh;
        ctx.beginPath(); ctx.moveTo(cx - halfW, y); ctx.lineTo(cx + halfW, y); ctx.stroke();
        const dotR   = Math.max(2, dSize * 0.90);
        const spacer = dotR * 2.8;
        const dotColors = [palette.lineColor, palette.accentColor, palette.diamondColor, palette.accentColor, palette.lineColor];
        const dotSizes  = [dotR * 0.60, dotR * 0.80, dotR, dotR * 0.80, dotR * 0.60];
        [-spacer * 2, -spacer, 0, spacer, spacer * 2].forEach((offset, i) => {
          ctx.fillStyle = dotColors[i];
          ctx.beginPath(); ctx.arc(cx + offset, y, dotSizes[i], 0, Math.PI * 2); ctx.fill();
        });
        break;
      }

      case 'minimal': {
        const halfW = lineW * 0.40;
        ctx.strokeStyle = palette.lineColor; ctx.lineWidth = lh;
        ctx.beginPath(); ctx.moveTo(cx - halfW, y); ctx.lineTo(cx + halfW, y); ctx.stroke();
        const dr = dSize * 1.0;
        ctx.strokeStyle = palette.diamondColor; ctx.lineWidth = lh * 1.8;
        ctx.beginPath();
        ctx.moveTo(cx, y - dr); ctx.lineTo(cx + dr, y);
        ctx.lineTo(cx, y + dr); ctx.lineTo(cx - dr, y);
        ctx.closePath(); ctx.stroke();
        break;
      }

      case 'modern': {
        const halfW   = lineW * 0.45;
        const numDots = 5;
        const dotR2   = Math.max(lh * 2, 2.5);
        const step    = (halfW * 2) / (numDots - 1);
        ctx.strokeStyle = palette.lineColor; ctx.lineWidth = lh;
        ctx.beginPath(); ctx.moveTo(cx - halfW, y); ctx.lineTo(cx + halfW, y); ctx.stroke();
        for (let i = 0; i < numDots; i++) {
          const dx = cx - halfW + i * step;
          const center = i === Math.floor(numDots / 2);
          ctx.fillStyle = center ? palette.accentColor : palette.lineColor;
          ctx.beginPath(); ctx.arc(dx, y, center ? dotR2 * 2.2 : dotR2, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }

      default: {
        const gap = dSize * 2.8;
        ctx.strokeStyle = palette.lineColor; ctx.lineWidth = lh;
        [[cx - lineW / 2, cx - gap], [cx + gap, cx + lineW / 2]].forEach(([x1, x2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        });
        ctx.fillStyle = palette.diamondColor;
        ctx.beginPath();
        ctx.moveTo(cx, y - dSize); ctx.lineTo(cx + dSize, y);
        ctx.lineTo(cx, y + dSize); ctx.lineTo(cx - dSize, y);
        ctx.closePath(); ctx.fill();
        const sr = dSize * 0.58;
        [cx - gap, cx + gap].forEach(dx => {
          ctx.fillStyle = palette.lineColor;
          ctx.beginPath();
          ctx.moveTo(dx, y - sr); ctx.lineTo(dx + sr, y);
          ctx.lineTo(dx, y + sr); ctx.lineTo(dx - sr, y);
          ctx.closePath(); ctx.fill();
        });
      }
    }
    clearShadow();
  }

  // ── 字体大小 ──
  const shopFontSize = Math.round(safeH * 0.18);
  const mainFontSize = Math.round(safeH * 0.15);
  const subFontSize  = Math.round(safeH * 0.12);
  const cntFontSize  = Math.round(safeH * 0.09);
  const lineGap      = Math.round(safeH * 0.04);

  // ── 排版列表（字重取自风格配置）──
  const items = [];
  if (shopName)  items.push({ text: shopName,  size: shopFontSize, weight: palette.shopWeight, style: 'shopgrad', isShop: true });
  if (shopName && (mainTitle || subTitle || phone || address)) items.push({ type: 'line' });
  if (mainTitle) items.push({ text: mainTitle, size: mainFontSize, weight: palette.mainWeight, style: 'main' });
  if (subTitle)  items.push({ text: subTitle,  size: subFontSize,  weight: palette.subWeight,  style: 'sub' });
  const contact = [phone, address].filter(Boolean).join('   ');
  if (contact)   items.push({ text: contact,   size: cntFontSize,  weight: palette.cntWeight,  style: 'contact' });

  // ── 总高度 & 垂直居中 ──
  let totalH = 0;
  items.forEach((item, i) => {
    totalH += item.type === 'line' ? Math.round(safeH * 0.07) : item.size;
    if (i < items.length - 1) totalH += lineGap;
  });
  const scale    = (totalH > safeH * 0.85) ? (safeH * 0.85) / totalH : 1;
  const textMidY = safeStartY + safeH * 0.52;
  let   curY     = textMidY - (totalH * scale) / 2;

  // ── 块框线 ──
  const borderPad = Math.round(safeH * 0.038);
  drawBlockBorder(curY - borderPad, curY + totalH * scale + borderPad, maxW * 0.62);

  // ── 逐项绘制 ──
  items.forEach((item, i) => {
    if (item.type === 'line') {
      const lineH = Math.round(safeH * 0.07 * scale);
      drawDecorLine(curY + lineH / 2, maxW * 0.55);
      curY += lineH;
    } else {
      const fs   = Math.round(item.size * scale);
      const midY = curY + fs / 2;
      let fillStyle;
      switch (item.style) {
        case 'shopgrad': fillStyle = makeGrad(midY, fs, palette.shopGrad); break;
        case 'main':     fillStyle = palette.mainColor;    break;
        case 'sub':      fillStyle = palette.subColor;     break;
        default:         fillStyle = palette.contactColor; break;
      }
      drawStyledText(item.text, midY, fs, item.weight, fillStyle, !!item.isShop);
      curY += fs;
    }
    if (i < items.length - 1) curY += Math.round(lineGap * scale);
  });

  return canvas.toBuffer('image/png');
}

module.exports = { overlayMerchantText, hasContent };
