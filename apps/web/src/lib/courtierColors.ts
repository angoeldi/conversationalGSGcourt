const COURTIER_PALETTE = [
  "#c8a357",
  "#7aa6d6",
  "#8fb7a7",
  "#e07a5f",
  "#a3b86f",
  "#c6906c",
  "#6f8c7f",
  "#b57aa1"
];

function hashId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getCourtierColor(characterId: string | undefined): string {
  if (!characterId) return COURTIER_PALETTE[0];
  const idx = hashId(characterId) % COURTIER_PALETTE.length;
  return COURTIER_PALETTE[idx];
}
