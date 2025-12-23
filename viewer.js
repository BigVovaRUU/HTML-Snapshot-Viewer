// viewer.js
function $(id) { return document.getElementById(id); }

function setStatus(text) { $("status").textContent = text || ""; }

function getQueryParam(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B","KB","MB","GB"];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b = b / 1024;
    i++;
  }
  return (i === 0 ? String(Math.round(b)) : b.toFixed(1)) + " " + units[i];
}

function suggestFilename(meta) {
  const safeHost = (() => {
    try { return new URL(meta?.url || location.href).host.replace(/[^a-zA-Z0-9.-]/g, "_"); }
    catch { return "page"; }
  })();

  const ts = (meta?.capturedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `${safeHost}_${ts}.html`;
}

async function loadSnapshot(id) {
  const key = "snap_" + id;
  const data = await chrome.storage.local.get([key]);
  return data[key] || null;
}

async function purgeSnapshot(id) {
  try {
    await chrome.runtime.sendMessage({ type: "PURGE_SNAPSHOT", id });
  } catch {
    // non-fatal
  }
}

function applyWrap(enabled) {
  $("codeArea").setAttribute("wrap", enabled ? "soft" : "off");
}

function findInTextarea(textarea, query, direction) {
  // direction: +1 next, -1 prev
  const text = textarea.value;
  if (!query) return { found: false };

  const q = query;
  const curStart = textarea.selectionStart ?? 0;
  const curEnd = textarea.selectionEnd ?? curStart;

  let idx = -1;

  if (direction > 0) {
    idx = text.indexOf(q, curEnd);
    if (idx === -1) idx = text.indexOf(q, 0); // wrap
  } else {
    const before = text.slice(0, Math.max(0, curStart - 1));
    idx = before.lastIndexOf(q);
    if (idx === -1) idx = text.lastIndexOf(q); // wrap
  }

  if (idx === -1) return { found: false };

  textarea.focus();
  textarea.setSelectionRange(idx, idx + q.length);
  // Scroll selection into view: approximate by setting scrollTop based on line count.
  // Browsers usually handle it after selectionRange+focus for textarea.
  return { found: true, index: idx };
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = getQueryParam("id");
  if (!id) {
    setStatus("Ошибка: отсутствует параметр id.");
    $("metaLine").textContent = "Нет данных.";
    return;
  }

  setStatus("Загрузка…");
  const snap = await loadSnapshot(id);

  if (!snap) {
    setStatus("Ошибка: снимок не найден (возможно, был очищен).");
    $("metaLine").textContent = "Нет данных.";
    return;
  }

  const html = String(snap.html || "");
  const meta = snap.meta || {};

  $("codeArea").value = html;

  const size = new Blob([html]).size;
  const metaLine = [
    meta.url ? meta.url : "",
    meta.capturedAt ? meta.capturedAt : "",
    size ? `• ${formatBytes(size)}` : "",
    meta.durationMs != null ? `• ${meta.durationMs} ms` : "",
  ].filter(Boolean).join(" ");

  $("metaLine").textContent = metaLine || "Готово.";

  // Wrap toggle
  $("wrapToggle").addEventListener("change", () => applyWrap($("wrapToggle").checked));
  applyWrap($("wrapToggle").checked);

  // Copy
  $("btnCopy").addEventListener("click", async () => {
    try {
      $("btnCopy").disabled = true;
      await navigator.clipboard.writeText($("codeArea").value);
      setStatus("Скопировано в буфер обмена.");
    } catch (e) {
      setStatus("Ошибка копирования: " + String(e?.message || e));
    } finally {
      $("btnCopy").disabled = false;
    }
  });

  // Save
  $("btnSave").addEventListener("click", async () => {
    try {
      $("btnSave").disabled = true;
      const blob = new Blob([$("codeArea").value], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const filename = suggestFilename(meta);

      const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: true,
      });

      // Give Chrome time to pick up the object URL, then revoke.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(`Файл сохранён: ${filename}`);
    } catch (e) {
      setStatus("Ошибка сохранения: " + String(e?.message || e));
    } finally {
      $("btnSave").disabled = false;
    }
  });

  // Search
  const doFind = (dir) => {
    const q = $("searchInput").value || "";
    const res = findInTextarea($("codeArea"), q, dir);
    setStatus(res.found ? "Найдено." : "Не найдено.");
  };

  $("btnFindNext").addEventListener("click", () => doFind(+1));
  $("btnFindPrev").addEventListener("click", () => doFind(-1));
  $("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doFind(e.shiftKey ? -1 : +1);
    }
  });

  // Optional: free storage once viewer loaded successfully.
  // Comment out if you prefer keeping snapshots for later.
  await purgeSnapshot(id);

  setStatus("Готово.");
});