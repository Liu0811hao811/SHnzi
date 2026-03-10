/**
 * App.jsx — AI 图片生成主界面
 *
 * 功能：
 *  1. 输入提示词 → 调用后端 /api/image/generate → 展示图片
 *  2. 历史记录（localStorage 持久化，最多 50 条）
 *  3. 下载图片（fetch blob → <a> 触发下载；CORS 失败时退降为新窗口打开）
 *  4. 灯箱放大预览
 *
 * 组件结构：
 *  <App>
 *    <TopNav>          — 顶部导航（生成 / 历史 标签切换）
 *    <GeneratePage>    — 生成页：输入框 + 选项 + 结果
 *    <HistoryPage>     — 历史页：图片网格 + 清空
 *    <Lightbox>        — 全屏预览弹层
 */

import { useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────

/** localStorage key，加版本号避免旧格式冲突 */
const HISTORY_KEY = 'img_gen_history_v1';

/** 最大历史条数 */
const MAX_HISTORY = 50;

/** 支持的图片尺寸选项 */
const SIZE_OPTIONS = [
  { value: '1024x1024', label: '1024 × 1024（方形）' },
  { value: '1792x1024', label: '1792 × 1024（横向）' },
  { value: '1024x1792', label: '1024 × 1792（纵向）' },
];

/** 质量选项 */
const QUALITY_OPTIONS = [
  { value: 'standard', label: '标准' },
  { value: 'hd',       label: '高清（HD）' },
];

// ─────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────

/** 从 localStorage 读取历史记录，解析失败���回空数组 */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
  } catch {
    return [];
  }
}

/** 将历史记录写入 localStorage（截取前 MAX_HISTORY 条） */
function saveHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

/** 将 ISO 时间格式化为 "M/D HH:mm" */
function fmtTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ` +
    `${String(d.getHours()).padStart(2, '0')}:` +
    `${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 截断文本，超出 n 字显示省略号 */
function truncate(text, n) {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

// ─────────────────────────────────────────────────────────
// 子组件：图片卡片
// ─────────────────────────────────────────────────────────

/**
 * ImageCard
 *
 * Props:
 *  img        — 图片记录对象 { id, url, prompt, size, quality, createdAt }
 *  showMeta   — 是否显示提示词和时间（历史页用）
 *  onView     — 点击图片时回调（打开灯箱）
 *  onDownload — 点击下载按钮时回调
 */
function ImageCard({ img, showMeta = false, onView, onDownload }) {
  // 图片加载失败时显示"链接已过期"占位
  const [broken, setBroken] = useState(false);

  return (
    <div className="img-card">
      {/* 图片区域（可点击放大） */}
      <div className="img-wrapper" onClick={onView}>
        {broken ? (
          <div className="img-broken">
            <span>🕐</span>
            <p>图片链接已过期</p>
            <small>DALL-E URL 在 1 小时后失效</small>
          </div>
        ) : (
          <>
            <img
              src={img.url}
              alt={img.prompt}
              loading="lazy"
              onError={() => setBroken(true)}
            />
            <div className="img-hover-tip">🔍 点击放大</div>
          </>
        )}
      </div>

      {/* 卡片底部 */}
      <div className="img-footer">
        {/* 历史页显示截断的提示词 */}
        {showMeta && (
          <p className="img-prompt" title={img.prompt}>
            {truncate(img.prompt, 48)}
          </p>
        )}

        <div className="img-tags-row">
          {/* 尺寸标签 */}
          <span className="tag">{img.size}</span>
          {/* 高清标签 */}
          {img.quality === 'hd' && <span className="tag tag-hd">HD</span>}
          {/* 历史页显示时间 */}
          {showMeta && <span className="tag tag-time">{fmtTime(img.createdAt)}</span>}

          {/* 下载按钮（推到右侧） */}
          <button
            className="dl-btn"
            onClick={e => { e.stopPropagation(); onDownload(); }}
            disabled={broken}
            title="下载图片"
          >
            ⬇
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────

export default function App() {
  // ── 状态 ──────────────────────────────────────────────
  const [prompt,        setPrompt]        = useState('');
  const [size,          setSize]          = useState('1024x1024');
  const [quality,       setQuality]       = useState('standard');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [currentImages, setCurrentImages] = useState([]);   // 本次生成结果
  const [history,       setHistory]       = useState(loadHistory); // 历史记录
  const [activeTab,     setActiveTab]     = useState('generate');  // 'generate' | 'history'
  const [lightbox,      setLightbox]      = useState(null);        // 灯箱图片对象

  // ── 副作用：历史变化时同步 localStorage ───────────────
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // ── 生成图片 ──────────────────────────────────────────
  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError('请先输入提示词');
      return;
    }

    setError('');
    setLoading(true);
    setCurrentImages([]);

    try {
      const res  = await fetch('/api/image/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt: trimmed, size, quality }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || '生成失败，请重试');
        return;
      }

      // 构造本地图片记录
      const imgs = data.images.map(img => ({
        id:             `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url:            img.url,
        prompt:         trimmed,
        size,
        quality,
        revised_prompt: img.revised_prompt || null,  // DALL-E 3 可能会优化提示词
        createdAt:      new Date().toISOString(),
      }));

      setCurrentImages(imgs);
      // 插入历史头部（最新的在最前面）
      setHistory(prev => [...imgs, ...prev]);

    } catch {
      setError('网络错误：请确认后端服务（端口 5000）已启动');
    } finally {
      setLoading(false);
    }
  }

  // ── 下载图片 ──────────────────────────────────────────
  async function handleDownload(img) {
    try {
      // 通过 fetch 获取 blob，再触发 <a> 下载，可指定文件名
      const response = await fetch(img.url);
      const blob     = await response.blob();
      const a        = document.createElement('a');
      a.href         = URL.createObjectURL(blob);
      a.download     = `ai-image-${img.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      // 跨域 fallback：直接新窗口打开，用户手动保存
      window.open(img.url, '_blank');
    }
  }

  // ── 清空历史 ──────────────────────────────────────────
  function handleClearHistory() {
    if (window.confirm('确定清空所有历史记录？此操作不可恢复。')) {
      setHistory([]);
    }
  }

  // ── 键盘：Enter 发送，Shift+Enter 换行 ────────────────
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !loading) {
      e.preventDefault();
      handleGenerate();
    }
  }

  // ─────────────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ══════════════ 顶部导航 ══════════════ */}
      <header className="top-nav">
        <div className="nav-brand">
          <span className="brand-icon">🎨</span>
          <span className="brand-name">AI 图片生成</span>
        </div>

        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'generate' ? 'active' : ''}`}
            onClick={() => setActiveTab('generate')}
          >
            ✨ 生成
          </button>
          <button
            className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            🕐 历史
            {history.length > 0 && (
              <span className="tab-badge">{history.length}</span>
            )}
          </button>
        </nav>
      </header>

      {/* ══════════════ 生成页 ══════════════ */}
      {activeTab === 'generate' && (
        <main className="page">

          {/* 输入卡片 */}
          <section className="card">
            <h2 className="card-title">描述你想要的图片</h2>

            {/* 提示词输入框 */}
            <textarea
              className="prompt-textarea"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                '描述你想要的图片，越详细效果越好…\n' +
                '例：一只在星空下弹吉他的橙色猫咪，梦幻水彩风格，8K 超清细节'
              }
              rows={4}
            />

            {/* 选项行 */}
            <div className="options-row">
              <div className="opt-group">
                <label className="opt-label" htmlFor="sel-size">尺寸</label>
                <select
                  id="sel-size"
                  className="opt-select"
                  value={size}
                  onChange={e => setSize(e.target.value)}
                >
                  {SIZE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="opt-group">
                <label className="opt-label" htmlFor="sel-quality">质量</label>
                <select
                  id="sel-quality"
                  className="opt-select"
                  value={quality}
                  onChange={e => setQuality(e.target.value)}
                >
                  {QUALITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* 生成按钮（独占右侧空间） */}
              <button
                className="gen-btn"
                onClick={handleGenerate}
                disabled={loading}
              >
                {loading
                  ? <><span className="spin" /> 生成中…</>
                  : '✨ 生成图片'}
              </button>
            </div>

            {/* 错误提示 */}
            {error && <div className="error-bar">⚠ {error}</div>}
          </section>

          {/* 骨架屏（生成中） */}
          {loading && (
            <section className="card center-col">
              <div className="skeleton-img" />
              <p className="skeleton-tip">AI 正在创作，通常需要 10–30 秒…</p>
            </section>
          )}

          {/* 生成结果 */}
          {!loading && currentImages.length > 0 && (
            <section className="card">
              {/* 结果标题 + 提示词摘要 */}
              <div className="result-header">
                <h3 className="card-title" style={{ margin: 0 }}>生成结果</h3>
                <span className="prompt-chip" title={currentImages[0].prompt}>
                  {truncate(currentImages[0].prompt, 52)}
                </span>
              </div>

              {/* 若 DALL-E 3 优化了提示词，显示优化版本 */}
              {currentImages[0].revised_prompt &&
               currentImages[0].revised_prompt !== currentImages[0].prompt && (
                <div className="revised-tip">
                  💡 <strong>AI 优化后的提示词：</strong>
                  {currentImages[0].revised_prompt}
                </div>
              )}

              {/* 图片（单张居中展示） */}
              <div className="single-result">
                {currentImages.map(img => (
                  <ImageCard
                    key={img.id}
                    img={img}
                    onView={() => setLightbox(img)}
                    onDownload={() => handleDownload(img)}
                  />
                ))}
              </div>
            </section>
          )}

        </main>
      )}

      {/* ══════════════ 历史页 ══════════════ */}
      {activeTab === 'history' && (
        <main className="page">
          <section className="card">
            <div className="result-header">
              <h2 className="card-title" style={{ margin: 0 }}>
                历史记录
                <span className="history-count">共 {history.length} 张</span>
              </h2>
              {history.length > 0 && (
                <button className="danger-btn" onClick={handleClearHistory}>
                  🗑 清空
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🖼</div>
                <p>暂无历史记录，切换到「生成」标签开始创作吧</p>
              </div>
            ) : (
              <div className="img-grid">
                {history.map(img => (
                  <ImageCard
                    key={img.id}
                    img={img}
                    showMeta
                    onView={() => setLightbox(img)}
                    onDownload={() => handleDownload(img)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {/* ══════════════ 灯箱（全屏预览） ══════════════ */}
      {lightbox && (
        <div
          className="lightbox-mask"
          onClick={() => setLightbox(null)}  /* 点击遮罩关闭 */
        >
          <div
            className="lightbox-box"
            onClick={e => e.stopPropagation()}  /* 阻止冒泡 */
          >
            <img
              src={lightbox.url}
              alt={lightbox.prompt}
              className="lightbox-img"
            />
            <div className="lightbox-bar">
              <p className="lightbox-prompt" title={lightbox.prompt}>
                {truncate(lightbox.prompt, 80)}
              </p>
              <div className="lightbox-btns">
                <button
                  className="gen-btn"
                  style={{ padding: '8px 20px', fontSize: '13px' }}
                  onClick={() => handleDownload(lightbox)}
                >
                  ⬇ 下载
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => setLightbox(null)}
                >
                  ✕ 关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
