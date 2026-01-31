export function formatPortraitPrompt(prompt: string, provider: "openai" | "hf"): string {
  if (provider !== "hf") return prompt;
  const suffix = [
    "Single subject portrait, upper body, centered composition.",
    "Realistic face, ornate clothing, dramatic lighting, painterly texture.",
    "No text, no watermark, no logo, no frame."
  ].join(" ");
  if (prompt.toLowerCase().includes("portrait")) {
    return `${prompt} ${suffix}`;
  }
  return `Portrait of ${prompt}. ${suffix}`;
}
