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

function setupSectionReveals() {
  const targets = [
    ...document.querySelectorAll(".manifesto > *, .feature-card, .network-visual, .network-content, .mac-copy, .install-steps > li, .terminal-fallback, .security > *, .download-head, .download-row"),
  ];

  document.documentElement.classList.add("motion-ready");
  targets.forEach((target, index) => {
    target.classList.add("reveal");
    target.style.setProperty("--reveal-delay", `${(index % 4) * 65}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    targets.forEach((target) => { target.dataset.visible = "true"; });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.dataset.visible = "true";
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.13, rootMargin: "0px 0px -5%" });

  targets.forEach((target) => observer.observe(target));
}

function setupNetworkDetails() {
  const items = [...document.querySelectorAll(".network-item")];
  items.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      items.forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });
}

function setupFriendNetwork() {
  const canvas = document.querySelector("#friend-network");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;

  const pointCount = 520;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const points = Array.from({ length: pointCount }, (_, index) => {
    const y = 1 - (index / (pointCount - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = goldenAngle * index;
    return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
  });
  const anchorIndexes = [24, 86, 154, 239, 336, 445];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [0, 5]];
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let canvasSize = 0;
  let frameId = 0;
  let sectionVisible = false;

  function resize() {
    const nextSize = Math.max(260, Math.round(canvas.getBoundingClientRect().width));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasSize = nextSize;
    canvas.width = Math.round(nextSize * pixelRatio);
    canvas.height = Math.round(nextSize * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw(performance.now());
  }

  function project(point, angle) {
    const tilt = -.18;
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const tiltedY = point.y * cosTilt - point.z * sinTilt;
    const tiltedZ = point.y * sinTilt + point.z * cosTilt;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const rotatedX = point.x * cosAngle - tiltedZ * sinAngle;
    const rotatedZ = point.x * sinAngle + tiltedZ * cosAngle;
    const perspective = 2.65 / (3.35 - rotatedZ);
    const radius = canvasSize * .41;
    return {
      x: canvasSize / 2 + rotatedX * radius * perspective,
      y: canvasSize / 2 + tiltedY * radius * perspective,
      z: rotatedZ,
      scale: perspective,
    };
  }

  function curvePoint(start, control, end, progress) {
    const inverse = 1 - progress;
    return {
      x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
      y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
    };
  }

  function draw(timestamp = 0) {
    if (!canvasSize) return;
    context.clearRect(0, 0, canvasSize, canvasSize);
    const angle = motionPreference.matches ? .42 : timestamp * .000055;
    const projected = points.map((point) => project(point, angle));
    const projectedAnchors = anchorIndexes.map((index) => projected[index]);

    projected
      .map((point, index) => ({ ...point, index }))
      .sort((a, b) => a.z - b.z)
      .forEach((point) => {
        const depth = (point.z + 1) / 2;
        const radius = .62 + depth * 1.12;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(25, 208, 232, ${.08 + depth * .44})`;
        context.fill();
      });

    edges.forEach(([startIndex, endIndex], edgeIndex) => {
      const start = projectedAnchors[startIndex];
      const end = projectedAnchors[endIndex];
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const bend = canvasSize * (.035 + (edgeIndex % 3) * .012);
      const control = { x: midpoint.x - (dy / length) * bend, y: midpoint.y + (dx / length) * bend };
      const pathOpacity = .13 + Math.max(start.z, end.z) * .08;

      context.beginPath();
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(control.x, control.y, end.x, end.y);
      context.strokeStyle = `rgba(68, 220, 238, ${Math.max(.07, pathOpacity)})`;
      context.lineWidth = 1;
      context.stroke();

      const progress = motionPreference.matches ? .45 : (timestamp * .00012 + edgeIndex * .17) % 1;
      const pulse = curvePoint(start, control, end, progress);
      const glow = context.createRadialGradient(pulse.x, pulse.y, 0, pulse.x, pulse.y, 9);
      glow.addColorStop(0, "rgba(165, 249, 255, .95)");
      glow.addColorStop(.25, "rgba(25, 208, 232, .7)");
      glow.addColorStop(1, "rgba(25, 208, 232, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(pulse.x, pulse.y, 9, 0, Math.PI * 2);
      context.fill();
    });

    projectedAnchors.forEach((point, index) => {
      const pulse = motionPreference.matches ? 1 : 1 + Math.sin(timestamp * .002 + index) * .15;
      const radius = 16 * pulse;
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      glow.addColorStop(0, "rgba(221, 253, 255, 1)");
      glow.addColorStop(.17, "rgba(25, 208, 232, .96)");
      glow.addColorStop(.45, "rgba(25, 208, 232, .23)");
      glow.addColorStop(1, "rgba(25, 208, 232, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
    });
  }

  function animate(timestamp) {
    frameId = 0;
    draw(timestamp);
    if (sectionVisible && !document.hidden && !motionPreference.matches) frameId = requestAnimationFrame(animate);
  }

  function updateAnimation() {
    if (sectionVisible && !document.hidden && !motionPreference.matches) {
      if (!frameId) frameId = requestAnimationFrame(animate);
    } else {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      draw(performance.now());
    }
  }

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    sectionVisible = entry.isIntersecting;
    updateAnimation();
  }, { rootMargin: "18% 0px", threshold: .05 });

  visibilityObserver.observe(canvas);
  new ResizeObserver(resize).observe(canvas);
  document.addEventListener("visibilitychange", updateAnimation);
  motionPreference.addEventListener?.("change", updateAnimation);
  resize();
}

loadLatestRelease();
setupSectionReveals();
setupNetworkDetails();
setupFriendNetwork();
