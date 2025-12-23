// service_worker.js (Manifest V3, module)
const STORAGE_PREFIX = "snap_";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab found.");
  return tab;
}

async function ensureContentScript(tabId) {
  // Inject the content script if not already present.
  // We inject on-demand to minimize footprint.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(window.__HTMLSNAP__ && window.__HTMLSNAP__.version),
    });
    // If above did not throw, it still may not be installed; check result:
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(window.__HTMLSNAP__ && window.__HTMLSNAP__.version),
    });
    if (result) return;
  } catch (_) {
    // ignored; we will inject below
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["contentScript.js"],
  });
}

async function captureFromTab(tabId, options) {
  await ensureContentScript(tabId);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts) => window.__HTMLSNAP__.capture(opts),
    args: [options],
  });

  if (!result || typeof result.html !== "string") {
    throw new Error("Capture failed: empty result.");
  }
  return result;
}

async function storeSnapshot(snapshot) {
  const id = crypto.randomUUID();
  const key = STORAGE_PREFIX + id;
  await chrome.storage.local.set({ [key]: snapshot });
  return { id, key };
}

async function openViewerWindow(id) {
  const url = chrome.runtime.getURL(`viewer.html?id=${encodeURIComponent(id)}`);
  await chrome.windows.create({
    url,
    type: "popup",
    width: 1100,
    height: 800,
  });
}

async function startInteractiveMode(tabId, options) {
  await ensureContentScript(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts) => window.__HTMLSNAP__.startInteractive(opts),
    args: [options],
  });
  await chrome.storage.session.set({ ["interactive_" + tabId]: true });
}

async function stopInteractiveMode(tabId) {
  await ensureContentScript(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__HTMLSNAP__.stopInteractive(),
  });
  await chrome.storage.session.remove(["interactive_" + tabId]);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) return;

      if (msg.type === "CAPTURE_OPEN_VIEWER") {
        const tab = msg.tabId ? { id: msg.tabId } : await getActiveTab();
        const snapshot = await captureFromTab(tab.id, msg.options || {});
        const { id } = await storeSnapshot(snapshot);
        await openViewerWindow(id);
        sendResponse({ ok: true, id });
        return;
      }

      if (msg.type === "CAPTURE_RETURN_HTML") {
        const tab = msg.tabId ? { id: msg.tabId } : await getActiveTab();
        const snapshot = await captureFromTab(tab.id, msg.options || {});
        sendResponse({ ok: true, html: snapshot.html, meta: snapshot.meta || null });
        return;
      }

      if (msg.type === "START_INTERACTIVE") {
        const tab = msg.tabId ? { id: msg.tabId } : await getActiveTab();
        await startInteractiveMode(tab.id, msg.options || {});
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "STOP_INTERACTIVE") {
        const tab = msg.tabId ? { id: msg.tabId } : await getActiveTab();
        await stopInteractiveMode(tab.id);
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "IS_INTERACTIVE_RUNNING") {
        const tab = msg.tabId ? { id: msg.tabId } : await getActiveTab();
        const state = await chrome.storage.session.get(["interactive_" + tab.id]);
        sendResponse({ ok: true, running: !!state["interactive_" + tab.id] });
        return;
      }

      if (msg.type === "WIDGET_CAPTURE_REQUEST") {
        // Message from the page widget: capture and open viewer.
        const tabId = sender?.tab?.id;
        if (!tabId) throw new Error("Missing sender tab id.");
        const snapshot = await captureFromTab(tabId, msg.options || {});
        const { id } = await storeSnapshot(snapshot);
        await openViewerWindow(id);
        sendResponse({ ok: true, id });
        return;
      }

      if (msg.type === "WIDGET_STOP_REQUEST") {
        const tabId = sender?.tab?.id;
        if (!tabId) throw new Error("Missing sender tab id.");
        await stopInteractiveMode(tabId);
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  // Keep the message channel open for async response
  return true;
});

// Optional hygiene: allow viewer to purge old snapshots.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "PURGE_SNAPSHOT" && msg.id) {
        const key = STORAGE_PREFIX + msg.id;
        await chrome.storage.local.remove([key]);
        sendResponse({ ok: true });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});