import type pg from "pg";
import { DecisionParseOutput as DecisionParseOutputSchema, TaskContext as TaskContextSchema, type TaskContext } from "@thecourt/shared";
import type { StorySeed } from "../lib/taskGeneration";

export async function buildStorySeeds(c: pg.PoolClient, gameId: string, currentTurn: number): Promise<StorySeed[]> {
  const taskRows = (await c.query(
    `SELECT task_id, task_type, context, closed_turn
     FROM tasks
     WHERE game_id = $1 AND closed_turn IS NOT NULL
     ORDER BY closed_turn DESC
     LIMIT 12`,
    [gameId]
  )).rows as Array<{ task_id: string; task_type: TaskContext["task_type"]; context: unknown; closed_turn: number | null }>;
  if (taskRows.length === 0) return [];

  const taskIds = taskRows.map((row) => row.task_id);
  const decisionRows = (await c.query(
    `SELECT DISTINCT ON (task_id) task_id, decision_json, processed_turn
     FROM decision_queue
     WHERE game_id = $1 AND task_id = ANY($2) AND status = 'processed'
     ORDER BY task_id, processed_turn DESC`,
    [gameId, taskIds]
  )).rows as Array<{ task_id: string; decision_json: unknown; processed_turn: number | null }>;

  const transcriptRows = (await c.query(
    `SELECT task_id, sender_type, sender_character_id, content, created_at
     FROM chat_messages
     WHERE task_id = ANY($1)
     ORDER BY created_at ASC`,
    [taskIds]
  )).rows as Array<{ task_id: string; sender_type: string; sender_character_id: string | null; content: string; created_at: string }>;

  const transcriptsByTask = new Map<string, Array<{ role: "player" | "courtier" | "system"; sender_character_id?: string; content: string }>>();
  for (const row of transcriptRows) {
    const role: "player" | "courtier" | "system" =
      row.sender_type === "player" || row.sender_type === "system" ? row.sender_type : "courtier";
    const entry = {
      role,
      sender_character_id: row.sender_character_id ?? undefined,
      content: row.content
    };
    const existing = transcriptsByTask.get(row.task_id) ?? [];
    existing.push(entry);
    transcriptsByTask.set(row.task_id, existing);
  }

  const decisionMap = new Map<string, { intent_summary?: string }>();
  for (const row of decisionRows) {
    const parsed = DecisionParseOutputSchema.safeParse(row.decision_json);
    if (parsed.success) decisionMap.set(row.task_id, { intent_summary: parsed.data.intent_summary });
  }

  const seeds: StorySeed[] = [];
  for (const row of taskRows) {
    const context = TaskContextSchema.safeParse(row.context);
    if (!context.success) continue;
    const story = context.data.story;
    const decisionSummary = decisionMap.get(row.task_id)?.intent_summary;
    const summary = story?.summary ?? summarizePrompt(context.data.prompt);
    const title = story?.title ?? summarizePrompt(context.data.prompt);
    const history = [...(story?.history ?? [])];
    const transcripts = [...(story?.transcripts ?? [])];
    const closedTurn = row.closed_turn ?? currentTurn - 1;
    const entry = formatStoryEntry(closedTurn, summary, decisionSummary);
    if (history[history.length - 1] !== entry) history.push(entry);
    const currentTranscript = transcriptsByTask.get(row.task_id);
    if (currentTranscript && currentTranscript.length > 0) {
      const transcriptEntry = { task_id: row.task_id, turn_index: closedTurn, messages: currentTranscript };
      if (!transcripts.find((t) => t.task_id === row.task_id)) transcripts.push(transcriptEntry);
    }
    seeds.push({
      story_id: story?.story_id ?? context.data.task_id,
      title,
      summary,
      history: history.slice(-6),
      last_turn: closedTurn,
      task_type: row.task_type,
      transcripts: transcripts.slice(-4)
    });
  }

  const deduped = new Map<string, StorySeed>();
  for (const seed of seeds) {
    const existing = deduped.get(seed.story_id);
    if (!existing || seed.last_turn > existing.last_turn) deduped.set(seed.story_id, seed);
  }

  return Array.from(deduped.values()).sort((a, b) => b.last_turn - a.last_turn);
}

function formatStoryEntry(turnIndex: number, summary: string, decisionSummary?: string): string {
  const decision = decisionSummary ? ` Decision: ${decisionSummary}` : "";
  return `Week ${turnIndex}: ${summary}.${decision}`.trim();
}

function summarizePrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const withoutReminder = cleaned.replace(/^Remember we did[^.]*\.\s*/i, "").trim();
  const base = withoutReminder || cleaned;
  const firstSentence = base.split(/(?<=[.!?])\s+/)[0] ?? base;
  if (firstSentence.length <= 140) return firstSentence;
  return `${firstSentence.slice(0, 137)}…`;
}
