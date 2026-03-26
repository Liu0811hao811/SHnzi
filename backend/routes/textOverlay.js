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
  return Object.values(info).some(v => {
    if (!v) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim().length > 0;
  });
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

// ── 分析 canvas 指定区域的平均亮度（0-255）──
// 用于决定蒙版深浅：背景越亮，蒙版越深，确保文字始终可读
function analyzeBrightness(sourceCanvas, zoneY, zoneH) {
  try {
    const W  = sourceCanvas.width;
    const sW = 50;
    const sH = Math.max(1, Math.round(sW * Math.max(1, zoneH) / W));
    const sc  = createCanvas(sW, sH);
    const sct = sc.getContext('2d');
    sct.drawImage(sourceCanvas, 0, Math.max(0, zoneY), W, Math.max(1, zoneH), 0, 0, sW, sH);
    const d = sct.getImageData(0, 0, sW, sH).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    return sum / (sW * sH);
  } catch { return 100; }
}

// ── 绘制文字区域背景蒙版（渐变遮罩，自适应亮度 + 风格配色）──
// 效果：文字区域像从图片中自然浮现，而非硬贴在图片上
function drawTextScrim(ctx, W, H, topY, bottomY, brightness, decorStyle) {
  const bandH   = Math.max(1, bottomY - topY);
  const fadeH   = Math.round(bandH * 0.55);
  const t0      = Math.max(0, topY    - fadeH);
  const t1      = Math.min(H, bottomY + fadeH);
  // 背景越亮蒙版越深，背景本已较暗则��轻避免图片太黑
  const opacity = brightness > 160 ? 0.68 : brightness > 100 ? 0.56 : 0.44;
  // 各风格蒙版底色（与对应配色方案协调）
  const BASE = {
    chinese:      [20,  5,  0],
    illustration: [14,  4, 24],
    photo:        [ 8,  8,  8],
    business:     [ 0,  8, 22],
    classic:      [14,  9,  0],
    dots:         [14,  4, 24],
    minimal:      [ 8,  8,  8],
    modern:       [ 0,  8, 22],
  };
  const [r, g, b] = BASE[decorStyle] || [12, 8, 0];
  const mid  = `rgba(${r},${g},${b},${opacity.toFixed(2)})`;
  const soft = `rgba(${r},${g},${b},${(opacity * 0.30).toFixed(2)})`;
  const grad = ctx.createLinearGradient(0, t0, 0, t1);
  grad.addColorStop(0,    'rgba(0,0,0,0)');
  grad.addColorStop(0.18, soft);
  grad.addColorStop(0.36, mid);
  grad.addColorStop(0.64, mid);
  grad.addColorStop(0.82, soft);
  grad.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, t0, W, t1 - t0);
}

/**
 * 在图片上叠加商家信息文字
 */
async function overlayMerchantText(imageBuf, merchantInfo, fanInfo = {}) {
  if (!hasContent(merchantInfo)) return imageBuf;

  const { shopName = '', mainTitle = '', subTitle = '', phone = '', address = '' } = merchantInfo;
  const subTitles = (merchantInfo.subTitles && merchantInfo.subTitles.length > 0)
    ? merchantInfo.subTitles
    : (subTitle ? [subTitle] : []);
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

  // ── 扇面圆形内切约束：根据每行 Y 动态限制文字最大宽度，防止超出扇形弧形边界 ──
  const fanR  = Math.min(W, H) * 0.46;  // 圆半径 ≈ 较小边的 46%
  const fanCy = H * 0.44;               // 圆心 Y ≈ 图片高度 44% 处
  function getCircleMaxW(y) {
    const dy = Math.abs(y - fanCy);
    if (dy >= fanR) return maxW * 0.3;
    return Math.min(2 * Math.sqrt(fanR * fanR - dy * dy) * 0.86, maxW);
  }

  // 模板模式下文字放大补偿：扇面包围盒嵌入整张模板后会缩小，
  // 用 tplH/H 的比例把字号等比放大，使最终显示尺寸与无模板时一致。
  const scaleMult = (fanInfo.tplH && fanInfo.tplH > H) ? fanInfo.tplH / H : 1;

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
  function drawStyledText(text, xPos, y, fontSize, fontWeight, fillStyle, isShopName, customMaxW, align = 'center') {
    if (!text) return;
    const mW = customMaxW !== undefined ? customMaxW : maxW;
    ctx.font         = `${fontWeight} ${fontSize}px ${palette.fontFamily}`;
    ctx.textAlign    = align;
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
    ctx.strokeText(text, xPos, y, mW);
    ctx.strokeText(text, xPos, y, mW); // 二遍叠加增亮
    clearShadow();

    // L2
    ctx.strokeStyle = palette.strokeColor;
    ctx.lineWidth   = Math.max(1, sw * 0.7);
    ctx.shadowColor = palette.innerGlow;
    ctx.shadowBlur  = fontSize * 0.12;
    ctx.strokeText(text, xPos, y, mW);
    clearShadow();

    // L3
    ctx.fillStyle     = fillStyle;
    ctx.shadowColor   = palette.dropShadow;
    ctx.shadowBlur    = fontSize * 0.16;
    ctx.shadowOffsetX = Math.round(fontSize * 0.02);
    ctx.shadowOffsetY = Math.round(fontSize * 0.06);
    ctx.fillText(text, xPos, y, mW);
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

  // ── 自定义文字行模式（前端编辑器调整后的位置 / 样式）──
  // 当 fanInfo.textLines 存在且非空时，按每行的精确坐标渲染，忽略自动排版
  if (fanInfo.textLines && Array.isArray(fanInfo.textLines) && fanInfo.textLines.length > 0) {
    const pal = STYLE_PALETTES[(fanInfo.genStyle || 'default').toLowerCase()] || STYLE_PALETTES.default;

    // 分析文字区域亮度，绘制自适应背景蒙版
    const activeLines = fanInfo.textLines.filter(l => l.text);
    if (activeLines.length > 0) {
      const lineYs = activeLines.map(l => (l.y != null ? l.y : 0.5) * H);
      const padY   = Math.round(H * 0.07);
      const scrimT = Math.min(...lineYs) - padY;
      const scrimB = Math.max(...lineYs) + padY;
      const br     = analyzeBrightness(canvas, scrimT, scrimB - scrimT);
      drawTextScrim(ctx, W, H, scrimT, scrimB, br, pal.decorStyle);
    }

    for (const line of fanInfo.textLines) {
      if (!line.text) continue;

      const x        = (line.x  != null ? line.x  : 0.5) * W;
      const y        = (line.y  != null ? line.y  : 0.5) * H;
      const fs       = Math.max(8, line.fontSize || Math.round(H * 0.06));
      const family   = line.fontFamily  || 'MSYaHei';
      const weight   = line.fontWeight  || 'normal';
      const rotation = line.rotation    || 0;
      const artStyle = line.artStyle    || '';
      const color    = line.color       || '#FFE840';
      const strokeC  = line.strokeColor || '#333333';
      const glowC    = line.glowColor   || '#FFD700';
      const lineMaxW = Math.round(W * 0.90);
      const sw       = Math.max(1, Math.round(fs * 0.08));

      ctx.save();
      if (rotation !== 0) {
        ctx.translate(x, y);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.translate(-x, -y);
      }

      // ── 促销项目：白色卡片 + 圆形序号徽章 + 文字 ──────────────────────
      if (line.style === 'promo') {
        const m = line.text.match(/^(\d+)\.\s*(.*)/);
        const badgeNum = m ? m[1] : '';
        const itemText = m ? m[2] : line.text;

        const bgStyleMap = { photo: 'festive', chinese: 'elegant', business: 'business', illustration: 'festive' };
        const themeKey   = bgStyleMap[(fanInfo.genStyle || '').toLowerCase()] || 'festive';
        const BADGE_BG   = { festive: 'rgba(200,50,0,0.75)',   business: 'rgba(0,50,160,0.75)',  elegant: 'rgba(120,20,0,0.75)'  };
        const BADGE_FG   = { festive: '#FFE840',               business: '#FFFFFF',              elegant: '#FFE8A0'              };
        const ACCENT     = { festive: '#FFD700',               business: '#60AAFF',              elegant: '#E8B860'              };
        const CARD_BG    = { festive: 'rgba(50,5,0,0.72)',     business: 'rgba(0,8,50,0.72)',    elegant: 'rgba(35,5,0,0.72)'   };
        const CARD_TEXT  = { festive: 'rgba(255,235,180,0.95)',business: 'rgba(200,225,255,0.95)',elegant: 'rgba(255,235,190,0.95)' };
        const badgeBg = BADGE_BG[themeKey] || BADGE_BG.festive;
        const badgeFg = BADGE_FG[themeKey] || BADGE_FG.festive;
        const accentC = ACCENT[themeKey]   || ACCENT.festive;

        ctx.font = `bold ${fs}px "Microsoft YaHei","MSYaHei",sans-serif`;
        const itemMetrics = ctx.measureText(itemText);
        const cardH    = Math.round(fs * 2.2);
        const badgeR   = Math.round(cardH * 0.28);
        const badgeAreaW = badgeR * 2 + Math.round(cardH * 0.3);
        const cardW    = Math.min(itemMetrics.width + badgeAreaW + fs * 0.8, W * 0.82);

        // 深色半透明背景盒子（去掉白色横带效果）
        ctx.fillStyle   = CARD_BG[themeKey] || 'rgba(40,5,0,0.72)';
        ctx.strokeStyle = accentC;
        ctx.lineWidth   = Math.max(1, Math.round(fs * 0.04));
        ctx.beginPath();
        ctx.roundRect(x - cardW / 2, y - cardH / 2, cardW, cardH, Math.round(cardH * 0.18));
        ctx.fill(); ctx.stroke();

        // 顶部高光条
        const hlG = ctx.createLinearGradient(x - cardW / 2, y, x + cardW / 2, y);
        hlG.addColorStop(0, accentC + '00'); hlG.addColorStop(0.5, accentC + '88'); hlG.addColorStop(1, accentC + '00');
        ctx.fillStyle = hlG;
        ctx.fillRect(x - cardW / 2 + 3, y - cardH / 2, cardW - 6, Math.round(cardH * 0.07));

        // 圆形序号徽章
        const badgeCX = x - cardW / 2 + badgeR + Math.round(cardH * 0.12);
        ctx.beginPath(); ctx.arc(badgeCX, y, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = badgeBg; ctx.fill();
        ctx.strokeStyle = accentC; ctx.lineWidth = Math.max(1, Math.round(badgeR * 0.15)); ctx.stroke();
        ctx.font = `bold ${Math.round(badgeR * 1.05)}px "Microsoft YaHei",sans-serif`;
        ctx.fillStyle = badgeFg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(badgeNum, badgeCX, y);

        // 促销文字（亮色，深底上可读）
        const textX    = badgeCX + badgeR + Math.round(cardH * 0.1);
        const textMaxW = cardW - (textX - (x - cardW / 2)) - Math.round(cardH * 0.08);
        ctx.font = `bold ${fs}px "Microsoft YaHei","MSYaHei",sans-serif`;
        ctx.fillStyle = CARD_TEXT[themeKey] || 'rgba(255,235,180,0.95)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(itemText, textX, y, textMaxW);

        ctx.restore();
        continue;
      }
      // ──────────────────────────────────────────────────────────────────

      ctx.font         = `${weight} ${fs}px "${family}", sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin     = 'round';

      // Art: stroke
      if (artStyle === 'stroke') {
        ctx.strokeStyle = strokeC;
        ctx.lineWidth   = Math.max(2, fs * 0.12);
        ctx.strokeText(line.text, x, y, lineMaxW);
      }

      // Art: glow
      if (artStyle === 'glow') {
        ctx.strokeStyle = glowC;
        ctx.lineWidth   = sw * 3;
        ctx.shadowColor = glowC;
        ctx.shadowBlur  = fs * 0.5;
        ctx.strokeText(line.text, x, y, lineMaxW);
        clearShadow();
      }

      // 对比描边（始终绘制，增强可读性）
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth   = Math.max(1, sw * 0.5);
      ctx.strokeText(line.text, x, y, lineMaxW);

      // 填充色
      let fillStyle = color;
      if (line.style === 'shopgrad' || artStyle === 'gradient') {
        const stops = line.colorStops || pal.shopGrad || ['#FFE840', '#FF7020'];
        const grad  = ctx.createLinearGradient(0, y - fs / 2, 0, y + fs / 2);
        stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
        fillStyle = grad;
      }
      ctx.fillStyle   = fillStyle;
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur  = fs * 0.1;
      ctx.fillText(line.text, x, y, lineMaxW);
      clearShadow();

      ctx.restore();
    }

    return { buffer: canvas.toBuffer('image/png'), textLines: fanInfo.textLines };
  }

  // ── 字体大小（乘以 scaleMult 补偿模板缩放）──
  const shopFontSize  = Math.round(H * 0.080 * scaleMult);
  const mainFontSize  = Math.round(H * 0.068 * scaleMult);
  const subFontSize   = Math.round(H * 0.055 * scaleMult);
  const cntFontSize   = Math.round(H * 0.045 * scaleMult);
  const promoFontSize = Math.round(H * 0.048 * scaleMult);

  // ── 固定位置（相对于图片尺寸的比例）──
  const shopY       = Math.round(H * 0.22);   // 店名：顶部居中
  const decorY      = Math.round(H * 0.29);   // 装饰线：店名下方
  const mainY       = Math.round(H * 0.38);   // 主标题：中部居中
  const subStartY   = Math.round(H * 0.47);   // 副标题起始
  const subDY       = Math.round(H * 0.072);  // 副标题行间距

  const promoX      = Math.round(W * 0.73);   // 促销项目：右侧 X
  const promoStartY = Math.round(H * 0.60);   // 促销起始 Y
  const promoDY     = Math.round(H * 0.10);   // 促销行间距

  const cntX        = Math.round(W * 0.27);   // 联系方式：左侧 X
  const phoneY      = Math.round(H * 0.78);   // 手机号 Y
  const addressY    = Math.round(H * 0.85);   // 地址 Y（手机号下方）

  const promoItems = (merchantInfo.promoItems || []).filter(Boolean);

  // ── 背景蒙版（各区域分别绘制）──
  if (shopName) {
    const br = analyzeBrightness(canvas, shopY - shopFontSize, shopFontSize * 3);
    drawTextScrim(ctx, W, H, shopY - shopFontSize, decorY + Math.round(shopFontSize * 0.5), br, palette.decorStyle);
  }
  if (mainTitle || subTitles.some(Boolean)) {
    const lastY = (mainTitle ? subStartY : mainY) + subTitles.filter(Boolean).length * subDY + subFontSize;
    const br = analyzeBrightness(canvas, mainY - mainFontSize, lastY - (mainY - mainFontSize));
    drawTextScrim(ctx, W, H, mainY - mainFontSize, lastY, br, palette.decorStyle);
  }
  if (promoItems.length > 0) {
    const promoEndY = promoStartY + promoItems.length * promoDY;
    const br = analyzeBrightness(canvas, promoStartY - promoFontSize, promoEndY - promoStartY + promoFontSize * 2);
    drawTextScrim(ctx, W, H, promoStartY - promoFontSize, promoEndY, br, palette.decorStyle);
  }
  if (phone || address) {
    const topY = phone ? phoneY - cntFontSize : addressY - cntFontSize;
    const botY = address ? addressY + cntFontSize : phoneY + cntFontSize;
    const br   = analyzeBrightness(canvas, topY, botY - topY);
    drawTextScrim(ctx, W, H, topY, botY, br, palette.decorStyle);
  }

  // ── 1. 店名（顶部居中）──
  if (shopName) {
    drawStyledText(shopName, cx, shopY, shopFontSize, palette.shopWeight,
      makeGrad(shopY, shopFontSize, palette.shopGrad), true, getCircleMaxW(shopY));
    if (mainTitle || subTitles.some(Boolean) || phone || address) {
      drawDecorLine(decorY, maxW * 0.55);
    }
  }

  // ── 2. 主标题（居中）──
  if (mainTitle) {
    drawStyledText(mainTitle, cx, mainY, mainFontSize, palette.mainWeight,
      palette.mainColor, false, getCircleMaxW(mainY));
  }

  // ── 3. 副标题（居中，主标题下方）──
  const firstSubY = mainTitle ? subStartY : mainY;
  subTitles.forEach((st, i) => {
    if (!st) return;
    const y = firstSubY + i * subDY;
    drawStyledText(st, cx, y, subFontSize, palette.subWeight,
      palette.subColor, false, getCircleMaxW(y));
  });

  // ── 4. 促销项目（右侧竖排）──
  promoItems.forEach((item, i) => {
    const y    = promoStartY + i * promoDY;
    const text = `${i + 1}. ${item}`;
    drawStyledText(text, promoX, y, promoFontSize, 'bold',
      palette.contactColor, false, Math.round(W * 0.42));
  });

  // ── 5. 手机号（左侧）──
  if (phone) {
    drawStyledText(phone, cntX, phoneY, cntFontSize, palette.cntWeight,
      palette.contactColor, false, Math.round(W * 0.40));
  }

  // ── 6. 地址（左侧，手机号下方）──
  if (address) {
    drawStyledText(address, cntX, addressY, cntFontSize, palette.cntWeight,
      palette.contactColor, false, Math.round(W * 0.40));
  }

  return { buffer: canvas.toBuffer('image/png'), textLines: [] };
}

module.exports = { overlayMerchantText, hasContent };
