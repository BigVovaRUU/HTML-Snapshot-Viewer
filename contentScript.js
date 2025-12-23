// contentScript.js
// Injected on-demand. Provides capture + optional interactive widget.

(() => {
  if (window.__HTMLSNAP__ && window.__HTMLSNAP__.version) return;

  const VERSION = "1.0.0";
  const WIDGET_ID = "__htmlsnap_widget__";
  const STYLE_ID = "__htmlsnap_style__";

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch {
      return "";
    }
  }

  function safeClick(el) {
    try {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch {
      return false;
    }
  }

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      return true;
    } catch {
      return false;
    }
  }

  function autoExpandTypicalElements() {
    // Conservative heuristics:
    // 1) Open all <details>
    // 2) Click buttons/role=button with aria-expanded="false"
    // 3) Click <summary> inside <details> if not open (handled by opening details)
    let actions = 0;

    try {
      document.querySelectorAll("details:not([open])").forEach((d) => {
        d.open = true;
        actions++;
      });
    } catch {}

    try {
      const candidates = Array.from(document.querySelectorAll('[aria-expanded="false"]'))
        .filter((el) => {
          const tag = (el.tagName || "").toLowerCase();
          const role = (el.getAttribute("role") || "").toLowerCase();
          const isButtonLike = tag === "button" || role === "button" || tag === "summary";
          const isLink = tag === "a";
          if (isLink) return false; // avoid navigation
          if (!isButtonLike) return false;
          if (!isVisible(el)) return false;
          return true;
        })
        .slice(0, 200); // safety limit

      for (const el of candidates) {
        if (safeClick(el)) actions++;
      }
    } catch {}

    return actions;
  }

  function collectSameOriginIframes() {
    const frames = [];
    const iframes = Array.from(document.querySelectorAll("iframe"));

    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.documentElement) continue;
        const src = iframe.getAttribute("src") || "";
        frames.push({
          index: i,
          src,
          html: doc.documentElement.outerHTML,
          title: doc.title || "",
        });
      } catch {
        // cross-origin; ignore
      }
    }
    return frames;
  }

  function collectOpenShadowRoots() {
    // We cannot inline shadow DOM into outerHTML without rewriting markup.
    // Instead, we append a structured comment block in the output.
    const shadows = [];
    try {
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        const el = node;
        if (el && el.shadowRoot) {
          shadows.push({
            hostTag: el.tagName,
            hostId: el.id || "",
            hostClass: el.className || "",
            html: el.shadowRoot.innerHTML || "",
          });
        }
        node = walker.nextNode();
      }
    } catch {}
    return shadows;
  }

  function getDoctypeString() {
    const dt = document.doctype;
    if (!dt) return "";
    const name = dt.name || "html";
    const publicId = dt.publicId ? ` PUBLIC "${dt.publicId}"` : "";
    const systemId = dt.systemId ? (publicId ? ` "${dt.systemId}"` : ` SYSTEM "${dt.systemId}"`) : "";
    return `<!DOCTYPE ${name}${publicId}${systemId}>`;
  }

  function buildHtmlWithExtras(baseHtml, extras) {
    const sections = [];
    if (extras?.iframes?.length) {
      sections.push("\n<!-- === HTML Snapshot: same-origin iframes ===\n");
      for (const fr of extras.iframes) {
        sections.push(
          `\n--- iframe[${fr.index}] src="${fr.src.replace(/"/g, "&quot;")}" title="${(fr.title || "").replace(/"/g, "&quot;")}" ---\n`
        );
        sections.push(fr.html || "");
        sections.push("\n");
      }
      sections.push("\n=== end iframes === -->\n");
    }

    if (extras?.shadows?.length) {
      sections.push("\n<!-- === HTML Snapshot: open shadow roots ===\n");
      for (let i = 0; i < extras.shadows.length; i++) {
        const sh = extras.shadows[i];
        sections.push(
          `\n--- shadowRoot[${i}] host=<${(sh.hostTag || "").toLowerCase()}> id="${(sh.hostId || "").replace(/"/g, "&quot;")}" class="${(sh.hostClass || "").toString().replace(/"/g, "&quot;")}" ---\n`
        );
        sections.push(sh.html || "");
        sections.push("\n");
      }
      sections.push("\n=== end shadow roots === -->\n");
    }

    if (!sections.length) return baseHtml;

    // Append extras near the end of the document.
    // If </html> exists, insert before it; otherwise append.
    const marker = "</html>";
    const idx = baseHtml.toLowerCase().lastIndexOf(marker);
    if (idx !== -1) {
      return baseHtml.slice(0, idx) + sections.join("") + baseHtml.slice(idx);
    }
    return baseHtml + sections.join("");
  }

  async function delayMs(ms) {
    if (!ms || ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }

  async function capture(options = {}) {
    const start = performance.now();

    const opts = {
      delayMs: Number(options.delayMs || 0),
      autoExpand: !!options.autoExpand,
      includeIframes: !!options.includeIframes,
      includeShadowDom: !!options.includeShadowDom,
    };

    if (opts.autoExpand) {
      autoExpandTypicalElements();
      // Give the page a moment to render expanded DOM if needed.
      await delayMs(250);
    }

    await delayMs(opts.delayMs);

    const doctype = getDoctypeString();
    const html = document.documentElement ? document.documentElement.outerHTML : "";
    let full = (doctype ? doctype + "\n" : "") + html;

    const extras = {};
    if (opts.includeIframes) {
      extras.iframes = collectSameOriginIframes();
    }
    if (opts.includeShadowDom) {
      extras.shadows = collectOpenShadowRoots();
    }

    full = buildHtmlWithExtras(full, extras);

    const end = performance.now();

    return {
      html: full,
      meta: {
        url: location.href,
        title: document.title || "",
        capturedAt: nowIso(),
        durationMs: Math.round(end - start),
        options: opts,
        extras: {
          iframes: extras.iframes ? extras.iframes.length : 0,
          shadows: extras.shadows ? extras.shadows.length : 0,
        },
      },
    };
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${WIDGET_ID} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483647;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        width: 320px;
        background: rgba(20, 20, 20, 0.92);
        color: #fff;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        overflow: hidden;
      }
      #${WIDGET_ID} .hs-header {
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      #${WIDGET_ID} .hs-title {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
      }
      #${WIDGET_ID} .hs-body {
        padding: 10px 12px 12px 12px;
        font-size: 12px;
        line-height: 1.35;
      }
      #${WIDGET_ID} .hs-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      #${WIDGET_ID} button {
        flex: 1;
        cursor: pointer;
        border: 0;
        border-radius: 10px;
        padding: 9px 10px;
        font-weight: 600;
        font-size: 12px;
      }
      #${WIDGET_ID} .hs-primary { background: #2d7ff9; color: #fff; }
      #${WIDGET_ID} .hs-secondary { background: rgba(255,255,255,0.12); color: #fff; }
      #${WIDGET_ID} .hs-note { opacity: 0.85; }
    `;
    document.documentElement.appendChild(style);
  }

  function createWidget(options = {}) {
    if (document.getElementById(WIDGET_ID)) return;
    injectStyle();

    const box = document.createElement("div");
    box.id = WIDGET_ID;

    const header = document.createElement("div");
    header.className = "hs-header";

    const title = document.createElement("div");
    title.className = "hs-title";
    title.textContent = "HTML Snapshot — режим записи";

    const closeBtn = document.createElement("button");
    closeBtn.className = "hs-secondary";
    closeBtn.style.flex = "0 0 auto";
    closeBtn.style.padding = "6px 10px";
    closeBtn.style.fontWeight = "700";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => stopInteractive());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "hs-body";
    body.innerHTML = `
      <div class="hs-note">
        Раскройте на странице нужные меню/списки/вкладки, затем нажмите «Захватить».
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "hs-actions";

    const captureBtn = document.createElement("button");
    captureBtn.className = "hs-primary";
    captureBtn.textContent = "Захватить";
    captureBtn.addEventListener("click", async () => {
      captureBtn.disabled = true;
      captureBtn.textContent = "Захват...";
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "WIDGET_CAPTURE_REQUEST",
          options,
        });
        if (!resp?.ok) throw new Error(resp?.error || "Capture failed");
      } catch (e) {
        alert("Не удалось захватить HTML: " + String(e?.message || e));
      } finally {
        captureBtn.disabled = false;
        captureBtn.textContent = "Захватить";
      }
    });

    const stopBtn = document.createElement("button");
    stopBtn.className = "hs-secondary";
    stopBtn.textContent = "Стоп";
    stopBtn.addEventListener("click", () => stopInteractive());

    actions.appendChild(captureBtn);
    actions.appendChild(stopBtn);

    body.appendChild(actions);

    box.appendChild(header);
    box.appendChild(body);

    document.documentElement.appendChild(box);
  }

  async function startInteractive(options = {}) {
    createWidget(options);
  }

  async function stopInteractive() {
    try {
      const w = document.getElementById(WIDGET_ID);
      if (w) w.remove();
      const s = document.getElementById(STYLE_ID);
      if (s) s.remove();
    } catch {}
    try {
      await chrome.runtime.sendMessage({ type: "WIDGET_STOP_REQUEST" });
    } catch {}
  }

  window.__HTMLSNAP__ = {
    version: VERSION,
    capture,
    startInteractive,
    stopInteractive,
  };
})();