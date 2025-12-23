// popup.js
function $(id) { return document.getElementById(id); }

function getOptions() {
  return {
    autoExpand: $("autoExpand").checked,
    includeIframes: $("includeIframes").checked,
    includeShadowDom: $("includeShadowDom").checked,
    delayMs: Number($("delay").value || 0),
  };
}

function getMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : "instant";
}

function setStatus(text) {
  $("status").textContent = text || "";
}

async function getActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return tab;
}

function setSiteSubtitle(tab) {
  try {
    const url = new URL(tab.url || "");
    $("siteSubtitle").textContent = url.host || "Активная вкладка";
  } catch {
    $("siteSubtitle").textContent = "Активная вкладка";
  }
}

async function refreshInteractiveControls(tabId) {
  const resp = await chrome.runtime.sendMessage({ type: "IS_INTERACTIVE_RUNNING", tabId });
  const running = !!resp?.running;
  $("btnStopInteractive").disabled = !running;
  $("btnStartInteractive").disabled = running;
}

function updateModeUI() {
  const mode = getMode();
  $("interactiveActions").hidden = mode !== "interactive";
}

document.addEventListener("change", (e) => {
  if (e.target && e.target.name === "mode") {
    updateModeUI();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  updateModeUI();
  const tab = await getActiveTabInfo();
  if (tab) {
    setSiteSubtitle(tab);
    await refreshInteractiveControls(tab.id);
  }

  $("btnCaptureOpen").addEventListener("click", async () => {
    setStatus("");
    const mode = getMode();
    const options = getOptions();

    try {
      $("btnCaptureOpen").disabled = true;

      if (mode === "interactive") {
        setStatus("В режиме записи используйте виджет на странице (кнопка «Запустить»).");
        return;
      }

      setStatus("Захват HTML…");
      const resp = await chrome.runtime.sendMessage({
        type: "CAPTURE_OPEN_VIEWER",
        options,
      });

      if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
      setStatus("Ок. Окно просмотра открыто.");
    } catch (e) {
      setStatus("Ошибка: " + String(e?.message || e));
    } finally {
      $("btnCaptureOpen").disabled = false;
    }
  });

  $("btnQuickCopy").addEventListener("click", async () => {
    setStatus("");
    const mode = getMode();
    const options = getOptions();

    try {
      $("btnQuickCopy").disabled = true;

      if (mode === "interactive") {
        setStatus("В режиме записи копирование делайте после захвата через виджет (в окне просмотра).");
        return;
      }

      setStatus("Захват HTML…");
      const resp = await chrome.runtime.sendMessage({
        type: "CAPTURE_RETURN_HTML",
        options,
      });

      if (!resp?.ok) throw new Error(resp?.error || "Unknown error");

      await navigator.clipboard.writeText(resp.html);
      setStatus("Скопировано в буфер обмена.");
    } catch (e) {
      setStatus("Ошибка: " + String(e?.message || e));
    } finally {
      $("btnQuickCopy").disabled = false;
    }
  });

  $("btnStartInteractive").addEventListener("click", async () => {
    setStatus("");
    const options = getOptions();
    const tab = await getActiveTabInfo();
    if (!tab?.id) {
      setStatus("Нет активной вкладки.");
      return;
    }

    try {
      $("btnStartInteractive").disabled = true;
      setStatus("Запуск виджета на странице…");
      const resp = await chrome.runtime.sendMessage({
        type: "START_INTERACTIVE",
        tabId: tab.id,
        options,
      });
      if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
      setStatus("Виджет запущен. Раскройте элементы на странице и нажмите «Захватить» в виджете.");
    } catch (e) {
      setStatus("Ошибка: " + String(e?.message || e));
    } finally {
      await refreshInteractiveControls(tab.id);
      $("btnStartInteractive").disabled = false;
    }
  });

  $("btnStopInteractive").addEventListener("click", async () => {
    setStatus("");
    const tab = await getActiveTabInfo();
    if (!tab?.id) {
      setStatus("Нет активной вкладки.");
      return;
    }

    try {
      $("btnStopInteractive").disabled = true;
      setStatus("Остановка виджета…");
      const resp = await chrome.runtime.sendMessage({
        type: "STOP_INTERACTIVE",
        tabId: tab.id,
      });
      if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
      setStatus("Виджет остановлен.");
    } catch (e) {
      setStatus("Ошибка: " + String(e?.message || e));
    } finally {
      await refreshInteractiveControls(tab.id);
    }
  });
});