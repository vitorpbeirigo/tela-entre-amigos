const RELEASE_API = "https://api.github.com/repos/vitorpbeirigo/tela-entre-amigos/releases/latest";

const assetMatchers = {
  windows: (name) => name.endsWith(".exe") && name.includes("setup"),
  "mac-arm64": (name) => name.endsWith(".dmg") && name.includes("arm64"),
  "mac-x64": (name) => name.endsWith(".dmg") && name.includes("x64"),
};

function findAsset(assets, platform) {
  const matcher = assetMatchers[platform];
  if (!matcher) return null;
  return assets.find((asset) => matcher(asset.name.toLowerCase())) || null;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido." });
  }

  try {
    const releaseResponse = await fetch(RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Infinity-Download-Service",
      },
    });

    if (!releaseResponse.ok) {
      throw new Error(`GitHub respondeu ${releaseResponse.status}`);
    }

    const release = await releaseResponse.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const platform = typeof request.query.platform === "string" ? request.query.platform : "";

    if (platform) {
      const asset = findAsset(assets, platform);
      if (!asset?.browser_download_url) {
        return response.status(404).json({ error: "Instalador não encontrado para esta plataforma." });
      }

      response.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
      return response.redirect(302, asset.browser_download_url);
    }

    const publicAssets = Object.keys(assetMatchers).flatMap((key) => {
      const asset = findAsset(assets, key);
      if (!asset) return [];
      return [{ name: asset.name, browser_download_url: `/baixar/${key}` }];
    });

    response.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return response.status(200).json({
      tag_name: release.tag_name || "Versão atual",
      assets: publicAssets,
    });
  } catch (error) {
    console.error("Falha ao consultar a versão mais recente:", error);
    return response.status(502).json({ error: "Não foi possível consultar os instaladores agora." });
  }
}
