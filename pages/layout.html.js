import { toast } from "../core/ui.js";

const SAMPLE_LAYOUT = `{
  "title": "倉庫1Fレイアウト（サンプル）",
  "canvas": { "width": 1200, "height": 800 },
  "zones": [
    { "id": "dock", "label": "入庫ドック", "x": 40, "y": 40, "width": 300, "height": 180, "color": "#dbeafe", "description": "入庫作業" },
    { "id": "inspection", "label": "検品", "x": 380, "y": 40, "width": 360, "height": 220, "color": "#fef3c7", "description": "検品ライン" },
    { "id": "packing", "label": "梱包", "x": 40, "y": 260, "width": 700, "height": 220, "color": "#fee2e2", "description": "梱包と仕分け" },
    { "id": "staging", "label": "出荷待ち", "x": 40, "y": 500, "width": 700, "height": 220, "color": "#dcfce7", "description": "出荷バッファ" }
  ],
  "notes": [
    "GPTから返ってきたJSONをそのまま貼り付けてレンダリングできます。",
    "x/y/width/heightはキャンバス基準のpx相対値です。"
  ]
}`;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function createZoneSummary(zone) {
  const dims = `${zone.width || "?"}×${zone.height || "?"}`;
  const position = `${zone.x || 0}, ${zone.y || 0}`;
  return `
    <li>
      <div class="zone-label">${zone.label || zone.id || "名称未設定"}</div>
      <div class="zone-meta mono">
        ID: ${zone.id || "-"} ／ 位置: ${position} ／ サイズ: ${dims}
      </div>
      ${zone.description ? `<div class="zone-desc">${zone.description}</div>` : ""}
    </li>
  `;
}

function buildZoneElement(zone, canvasWidth, canvasHeight) {
  const zoneEl = document.createElement("div");
  zoneEl.className = "layout-zone";
  const width = Math.max(toNumber(zone.width, 1), 1);
  const height = Math.max(toNumber(zone.height, 1), 1);
  const left = clamp((toNumber(zone.x, 0) / canvasWidth) * 100, 0, 100);
  const top = clamp((toNumber(zone.y, 0) / canvasHeight) * 100, 0, 100);
  const rightEdge = clamp(((toNumber(zone.x, 0) + width) / canvasWidth) * 100, 0, 100);
  const bottomEdge = clamp(((toNumber(zone.y, 0) + height) / canvasHeight) * 100, 0, 100);
  const computedWidth = Math.max(rightEdge - left, 2);
  const computedHeight = Math.max(bottomEdge - top, 2);

  zoneEl.style.left = `${left}%`;
  zoneEl.style.top = `${top}%`;
  zoneEl.style.width = `${computedWidth}%`;
  zoneEl.style.height = `${computedHeight}%`;
  if (zone.color) {
    zoneEl.style.setProperty("--zone-color", zone.color);
  }
  zoneEl.innerHTML = `
    <div class="zone-title">${zone.label || zone.id || "Unnamed"}</div>
    ${zone.description ? `<div class="zone-note">${zone.description}</div>` : ""}
  `;
  return zoneEl;
}

export function renderLayout(mount) {
  const wrap = document.createElement("div");
  wrap.className = "panel layout-panel";
  wrap.innerHTML = `
    <h2>AIレイアウトプレビュー</h2>
    <div class="hint">GPTが出力したJSONを貼り付けるだけで描画に反映されます。</div>
    <div class="layout-tool">
      <section class="layout-input">
        <label>
          JSON（GPT出力）
          <textarea id="layoutJson" spellcheck="false"></textarea>
        </label>
        <div class="form-actions" style="margin-top:8px">
          <button id="renderLayout" class="button" type="button">このJSONで描画</button>
          <button id="restoreSample" class="button ghost" type="button">サンプルを復元</button>
        </div>
        <div id="layoutError" class="hint" aria-live="polite"></div>
      </section>
      <section class="layout-preview">
        <div id="layoutMeta" class="layout-meta"></div>
        <div id="layoutBoard" class="layout-board"></div>
        <ul id="zoneList" class="zone-list"></ul>
        <ul id="layoutNotes" class="layout-notes"></ul>
      </section>
    </div>
  `;
  mount.appendChild(wrap);

  const textarea = wrap.querySelector("#layoutJson");
  const renderBtn = wrap.querySelector("#renderLayout");
  const sampleBtn = wrap.querySelector("#restoreSample");
  const errorEl = wrap.querySelector("#layoutError");
  const board = wrap.querySelector("#layoutBoard");
  const metaEl = wrap.querySelector("#layoutMeta");
  const zoneList = wrap.querySelector("#zoneList");
  const notesList = wrap.querySelector("#layoutNotes");

  textarea.value = SAMPLE_LAYOUT;

  function draw(layout) {
    const canvasWidth = Math.max(toNumber(layout?.canvas?.width, 100), 1);
    const canvasHeight = Math.max(toNumber(layout?.canvas?.height, 100), 1);
    board.innerHTML = "";
    board.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;

    const zones = Array.isArray(layout?.zones) ? layout.zones : [];
    if (!zones.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "ゾーンがありません。JSONにzones配列を含めてください。";
      board.appendChild(empty);
    } else {
      zones.forEach((zone) => {
        board.appendChild(buildZoneElement(zone, canvasWidth, canvasHeight));
      });
    }

    metaEl.textContent = layout?.title || "タイトル未設定";
    zoneList.innerHTML = zones.length
      ? zones.map((zone) => createZoneSummary(zone)).join("")
      : '<li class="hint">ゾーン情報がありません</li>';

    const notes = Array.isArray(layout?.notes) ? layout.notes : [];
    notesList.innerHTML = notes.length
      ? notes.map((note) => `<li>${note}</li>`).join("")
      : "";
  }

  function renderFromInput() {
    let data;
    try {
      data = JSON.parse(textarea.value || "{}");
      errorEl.textContent = "";
    } catch (err) {
      console.error("[Layout] JSON parse failed", err);
      errorEl.textContent = "JSONの解析に失敗しました。形式を確認してください。";
      toast("JSONの解析に失敗しました", "error");
      board.innerHTML = "";
      zoneList.innerHTML = '<li class="hint">描画できません</li>';
      notesList.innerHTML = "";
      metaEl.textContent = "";
      return;
    }
    draw(data);
  }

  renderBtn.addEventListener("click", () => {
    renderFromInput();
    toast("JSONを描画しました");
  });

  sampleBtn.addEventListener("click", () => {
    textarea.value = SAMPLE_LAYOUT;
    renderFromInput();
    toast("サンプルJSONを読み込みました");
  });

  renderFromInput();
}
