export function mountUI(root) {
  root.innerHTML = `
    <canvas class="scene" id="scene" aria-label="三维高程地形瓦片视图"></canvas>
    <div class="vignette"></div>
    <div class="grain"></div>
    <div class="scanline"></div>

    <div class="chrome">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div>
            <h1>TERRAIN / LOD ATLAS</h1>
            <p>高程瓦片 · 实时流式加载</p>
          </div>
        </div>

        <nav class="toolbar" aria-label="视图工具">
          <button class="tool" id="wireToggle" aria-pressed="false" title="显示瓦片边界线框">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2h12v12H2zM2 2l12 12M14 2L2 14"/>
            </svg>
            <span>瓦片线框</span>
          </button>
          <button class="tool tool-icon" id="resetView" title="重置视角">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 6a5 5 0 1 0 .4 4M13 2v4H9"/>
            </svg>
          </button>
          <div class="export-wrap">
            <button class="tool primary" id="exportButton" aria-expanded="false">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2v8m0 0L5 7m3 3 3-3M2.5 11.5v2h11v-2"/>
              </svg>
              <span>导出总览</span>
            </button>
            <div class="export-menu" id="exportMenu" role="menu">
              <small>单级别完整高程总览 · PNG</small>
              <button class="export-option" data-export="0" role="menuitem">
                <span>L0 · 区域概览</span><em>4 × 4 / 16 TILES</em>
              </button>
              <button class="export-option" data-export="1" role="menuitem">
                <span>L1 · 流域概览</span><em>8 × 8 / 64 TILES</em>
              </button>
              <button class="export-option" data-export="2" role="menuitem">
                <span>L2 · 山脊概览</span><em>16 × 16 / 256 TILES</em>
              </button>
            </div>
          </div>
        </nav>
      </header>

      <div class="compass" aria-hidden="true">
        <span>N</span>
        <i class="compass-needle" id="compassNeedle"></i>
      </div>

      <aside class="lod-rail" aria-label="细节级别">
        <div class="rail-label">GLOBAL SAMPLE 8M</div>
        <div class="rail-track">
          <i class="rail-thumb" id="railThumb" style="top: 50%"></i>
        </div>
        <div class="rail-levels">
          <button class="level-button" data-level="0"><b>L0</b><span>区域</span></button>
          <button class="level-button" data-level="1"><b>L1</b><span>流域</span></button>
          <button class="level-button" data-level="2"><b>L2</b><span>山脊</span></button>
        </div>
      </aside>

      <section class="stats-card" aria-label="缓存与内存统计">
        <div class="stats-head">
          <strong>RESIDENCY / CACHE</strong>
          <span class="live-status"><i class="live-dot"></i>LIVE</span>
        </div>
        <div class="stat-hero">
          <div>
            <small>缓存命中率</small>
            <strong><span id="hitRate">0.0</span><i>%</i></strong>
          </div>
          <svg class="hit-spark" viewBox="0 0 92 34" preserveAspectRatio="none" aria-hidden="true">
            <polyline id="hitSpark" points="0,30 12,30 24,30 36,30 48,30 60,30 72,30 84,30 92,30"/>
          </svg>
        </div>
        <div class="stat-grid">
          <div class="stat-cell">
            <small>当前内存</small>
            <strong><span id="memoryValue">0.0</span><i> MB</i></strong>
            <div class="memory-bar"><i class="memory-fill" id="memoryFill"></i></div>
          </div>
          <div class="stat-cell">
            <small>常驻瓦片</small>
            <strong><span id="residentValue">0</span><i> / <span id="residentTotal">0</span></i></strong>
          </div>
        </div>
        <div class="cache-detail">
          <span>HIT <strong id="hitCount">0</strong></span>
          <span>MISS <strong id="missCount">0</strong></span>
          <span>EVICT <strong class="hot" id="evictCount">0</strong></span>
          <strong id="queueCount">QUEUE 0</strong>
        </div>
        <div class="tile-mosaic" id="tileMosaic" aria-hidden="true"></div>
      </section>

      <div class="lower-left">
        <div class="readout">
          <div class="readout-group">
            <small>ACTIVE LOD</small>
            <strong id="activeLod">L1 · 8×8</strong>
          </div>
          <div class="readout-group">
            <small>VISIBLE</small>
            <strong id="visibleTiles">0 TILES</strong>
          </div>
          <div class="readout-group">
            <small>ALTITUDE</small>
            <strong id="altitude">0 M</strong>
          </div>
          <div class="readout-group">
            <small>SEAM Δ</small>
            <strong id="seamDelta">0.000 M</strong>
          </div>
        </div>
        <div class="action-row">
          <button class="verify-button" id="verifyButton">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 8h2l1.5-4 3 8 2-6 1.5 2H14"/>
            </svg>
            运行两轮缩放验证
          </button>
        </div>
        <div class="help">
          <span><kbd>拖拽</kbd> 旋转</span>
          <span><kbd>滚轮</kbd> 连续缩放</span>
          <span><kbd>右键</kbd> 平移</span>
        </div>
      </div>

      <div class="verify-panel" id="verifyPanel" role="dialog" aria-label="接缝与缓存验证结果">
        <header>
          <strong>CONTINUOUS ZOOM / AUDIT</strong>
          <button id="closeVerify" aria-label="关闭">×</button>
        </header>
        <div class="verify-list" id="verifyList"></div>
      </div>

      <div class="toast" id="toast" role="status">
        <i class="toast-dot"></i>
        <span id="toastText"></span>
      </div>
    </div>

    <div class="boot" id="boot">
      <div class="boot-code">BUILDING ELEVATION PYRAMID</div>
      <div class="boot-line"></div>
    </div>
  `;
}
