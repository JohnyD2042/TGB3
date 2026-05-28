/** Публичный URL сервиса на Railway (для регистрации Telegram webhook). */
export function resolvePublicOrigin(): string | null {
  const fromRailway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (fromRailway) {
    const host = fromRailway.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }
  const fromPublic = process.env.PUBLIC_URL?.trim();
  if (!fromPublic) return null;
  if (fromPublic.startsWith("http")) return fromPublic.replace(/\/$/, "");
  const host = fromPublic.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}`;
}

export function resolveWebhookUrl(): string | null {
  const origin = resolvePublicOrigin();
  return origin ? `${origin}/telegram/webhook` : null;
}
