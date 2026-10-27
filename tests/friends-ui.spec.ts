import { expect, test } from "@playwright/test";
import { createFriendsRoom, mockFriendsDesktop, shareInFriendsRoom } from "./helpers/friends-desktop";

test("cria sala salva, preserva convite após reload e sai sem apagar", async ({ page }) => {
  await mockFriendsDesktop(page); await page.goto("/");
  const invite = await createFriendsRoom(page);
  expect(invite).toMatch(/^INFINITY1:/);
  await expect(page.getByRole("heading", { name: "Sala da turma", exact: true })).toBeVisible();
  await expect(page.getByText("Só você por enquanto", { exact: true })).toBeVisible();
  await shareInFriendsRoom(page);
  await expect(page.getByRole("button", { name: "Parar compartilhamento", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sair da sala", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Entrar na sala Sala da turma", exact: true })).toBeVisible();
  await expect(page.getByLabel("Seu nome na sala")).toHaveValue("Greg");
  await page.getByRole("button", { name: "Entrar na sala Sala da turma", exact: true }).click();
  await page.getByRole("button", { name: "Copiar convite", exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("copied-invite"))).toBe(invite);
  await expect(page.getByRole("button", { name: "Compartilhar tela", exact: true })).toBeVisible();
});

test("convite inválido não cria sala e layout funciona na menor janela", async ({ page }) => {
  await mockFriendsDesktop(page); await page.setViewportSize({ width: 960, height: 680 }); await page.goto("/");
  await page.getByRole("button", { name: "Salas de amigos", exact: true }).click();
  await page.getByLabel("Seu nome na sala").fill("Amigo");
  await page.getByLabel("Convite da sala").fill("wrong-invite");
  await page.getByRole("button", { name: "Salvar e entrar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Convite inválido");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("infinity-saved-rooms-v1"))).toBeNull();
});

test("Mac oferece captura sem áudio do sistema para evitar retorno do Discord", async ({ page }) => {
  await mockFriendsDesktop(page, "darwin"); await page.goto("/");
  const guide = page.getByRole("button", { name: "Entendi", exact: true });
  if (await guide.isVisible()) await guide.click();
  await createFriendsRoom(page);
  await page.getByRole("button", { name: "Compartilhar tela", exact: true }).click();
  await expect(page.getByLabel("Compartilhar áudio do computador")).not.toBeChecked();
  await expect(page.getByText(/No Mac, o áudio do sistema também inclui o Discord/)).toBeVisible();
});

test("armazenamento bloqueado mostra orientação sem derrubar o aplicativo", async ({ page }) => {
  await mockFriendsDesktop(page);
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Salas de amigos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salas de amigos", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível ler as salas salvas");
});
