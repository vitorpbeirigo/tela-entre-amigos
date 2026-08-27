const RELEASE_API = "https://api.github.com/repos/vitorpbeirigo/tela-entre-amigos/releases/latest";
const RELEASE_PAGE = "https://github.com/vitorpbeirigo/tela-entre-amigos/releases/latest";

const assetLinks = {
  windows: document.querySelector('[data-asset="windows"]'),
  "mac-arm64": document.querySelector('[data-asset="mac-arm64"]'),
  "mac-x64": document.querySelector('[data-asset="mac-x64"]'),
};

function classifyAsset(name) {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".exe") && normalized.includes("setup")) return "windows";
  if (normalized.endsWith(".dmg") && normalized.includes("arm64")) return "mac-arm64";
  if (normalized.endsWith(".dmg") && normalized.includes("x64")) return "mac-x64";
  return null;
}

function preferredDownload() {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  if (/win/i.test(platform)) return assetLinks.windows;
  return null;
}

async function loadLatestRelease() {
  const status = document.querySelector(".release-status");
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
    const release = await response.json();
    for (const asset of release.assets || []) {
      const key = classifyAsset(asset.name);
      if (key && assetLinks[key]) assetLinks[key].href = asset.browser_download_url;
    }
    status.textContent = `${release.tag_name || "Versão atual"} · publicada pelo GitHub Releases`;
    const smartLink = document.querySelector(".smart-download");
    const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
    const preferred = preferredDownload();
    if (/mac/i.test(platform)) {
      smartLink.href = "#download";
      smartLink.querySelector("span").textContent = "Escolher versão para macOS";
    } else if (preferred?.href) {
      smartLink.href = preferred.href;
      smartLink.querySelector("span").textContent = "Baixar para Windows";
    }
  } catch (error) {
    status.textContent = "Abra a página de versões para escolher o instalador.";
    Object.values(assetLinks).forEach((link) => { if (link) link.href = RELEASE_PAGE; });
  }
}

document.querySelector("[data-copy-command]")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const command = button.parentElement.querySelector("code")?.textContent || "";
  try {
    await navigator.clipboard.writeText(command);
    button.textContent = "Copiado";
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(button.parentElement.querySelector("code"));
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = "Selecione e copie";
  }
  window.setTimeout(() => { button.textContent = "Copiar"; }, 2200);
});

loadLatestRelease();
