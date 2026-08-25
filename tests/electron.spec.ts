import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";

test("o aplicativo Electron lista fontes reais e inicia a captura", async () => {
  const packagedExecutable = process.env.TELA_PACKAGED_EXE;
  const app = await electron.launch(
    packagedExecutable
      ? { executablePath: packagedExecutable }
      : { args: [path.resolve(".")], cwd: path.resolve(".") },
  );

  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on("pageerror", (error) => errors.push(error.message));

    await expect(window.getByRole("heading", { name: /Sua tela/i })).toBeVisible();
    await window.getByRole("button", { name: /Compartilhar minha tela/i }).click();
    await expect(window.getByRole("heading", { name: /O que você quer mostrar/i })).toBeVisible();

    const sources = window.locator(".source-card");
    await expect(sources.first()).toBeVisible({ timeout: 15_000 });
    expect(await sources.count()).toBeGreaterThan(0);

    await window.getByRole("button", { name: /Iniciar transmissão/i }).click();
    await expect(window.getByRole("heading", { name: /Sua tela está sendo compartilhada/i })).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".room-code-copy")).toContainText(/^[A-Z2-9-]{23}$/);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
