import { DIRECTIONS, type DirectionId, TIME_ZONE } from "./config";

export type CardInput = {
  sample?: boolean;
  answer: "yes" | "no" | "unknown";
  direction: DirectionId;
  at: string | null;
};

export type CardEnv = { ASSETS: Fetcher; IMAGES?: ImagesBinding; PUBLIC_ORIGIN: string };

export function cardLines(card: CardInput): [string, string, string] {
  const d = DIRECTIONS[card.direction];
  const route = `${d.label} · ${d.from} to ${d.to}`;
  const traffic =
    card.answer === "no" ? "Traffic is backed up" : card.answer === "yes" ? "Traffic is moving" : "No current check";
  const when = card.at
    ? new Date(card.at).toLocaleString("en-US", {
        timeZone: TIME_ZONE,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  if (card.sample) return [route, "SAMPLE · not live traffic", "Design preview"];
  return [route, traffic, when ? `${when} Central` : ""];
}

export async function renderCard(card: CardInput, env: CardEnv): Promise<Response> {
  const base = await env.ASSETS.fetch(new URL(`/cards/${card.answer}.png`, env.PUBLIC_ORIGIN));
  if (!env.IMAGES || !base.body) {
    return new Response(base.body, { headers: { "content-type": "image/png", "x-card-render": "static" } });
  }
  const fg = card.answer === "yes" ? "#111111" : "#ffffff";
  const font = (weight: string) => ({ url: `${env.PUBLIC_ORIGIN}/fonts/NotoSans-${weight}.ttf` });
  const [route, traffic, when] = cardLines(card);

  let chain = env.IMAGES.input(base.body)
    .draw(env.IMAGES.text(route, { font: font("Bold"), color: fg, size: 40 }), { top: 1092 })
    .draw(env.IMAGES.text(traffic, { font: font("Bold"), color: fg, size: 56 }), { top: 1148 });
  if (when) chain = chain.draw(env.IMAGES.text(when, { font: font("Medium"), color: fg, size: 34 }), { top: 1222 });

  const out = await chain.output({ format: "image/jpeg", quality: 88 });
  return out.response();
}
