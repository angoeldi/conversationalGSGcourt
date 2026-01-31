import type { Action, DecisionParseOutput, Scenario, TaskContext } from "@thecourt/shared";
import { Action as ActionSchema } from "@thecourt/shared";

export function coerceDecisionToScenario(
  decision: DecisionParseOutput,
  scenario: Scenario,
  taskContext: TaskContext,
  options?: { limitFreeformDeltas?: boolean; strictActionsOnly?: boolean }
): DecisionParseOutput {
  const allowedTypes = new Set(taskContext.constraints.allowed_action_types ?? []);
  const enforceAllowed = allowedTypes.size > 0;
  const forbiddenTypes = new Set(taskContext.constraints.forbidden_action_types ?? []);

  const nationIds = new Set(scenario.nations.map((n) => n.nation_id));
  const playerNationId = scenario.player_nation_id;
  const nonPlayerNationId = scenario.nations.find((n) => n.nation_id !== playerNationId)?.nation_id ?? playerNationId;

  const provinceIds = new Set(scenario.province_snapshots.map((p) => p.geo_region_id));
  const playerProvinceId = scenario.province_snapshots.find((p) => p.nation_id === playerNationId)?.geo_region_id
    ?? scenario.province_snapshots[0]?.geo_region_id;

  const officeIds = new Set(scenario.offices.map((o) => o.office_id));
  const playerOfficeId = scenario.offices.find((o) => o.nation_id === playerNationId)?.office_id
    ?? scenario.offices[0]?.office_id;

  const characterIds = new Set(scenario.characters.map((c) => c.character_id));
  const appointmentByOffice = new Map(scenario.appointments.map((a) => [a.office_id, a.character_id]));
  const fallbackCharacterId = scenario.characters[0]?.character_id
    ?? appointmentByOffice.get(playerOfficeId ?? "")
    ?? scenario.characters[0]?.character_id;

  const fallbackAction: Action = {
    type: "create_committee",
    params: {
      topic: taskContext.prompt,
      duration_weeks: 4,
      budget: 0
    }
  };

  const nextBundles = decision.proposed_bundles.map((bundle, index) => {
    const actions: Action[] = [];

    for (const action of bundle.actions) {
      if (forbiddenTypes.has(action.type)) continue;
      if (enforceAllowed && !allowedTypes.has(action.type)) continue;
      if (options?.strictActionsOnly && action.type === "freeform_effect") continue;

      let coerced = coerceAction(action, {
        nationIds,
        provinceIds,
        officeIds,
        characterIds,
        playerNationId,
        nonPlayerNationId,
        playerProvinceId,
        playerOfficeId,
        fallbackCharacterId,
        appointmentByOffice
      });

      if (coerced && options?.limitFreeformDeltas && coerced.type === "freeform_effect") {
        coerced = {
          ...coerced,
          params: {
            ...coerced.params,
            limit_deltas: true
          }
        };
      }

      if (coerced) actions.push(coerced);
    }

    if (actions.length === 0) {
      actions.push(fallbackAction);
    }

    return {
      ...bundle,
      label: bundle.label || (index === 0 ? "A" : "B: Alternative"),
      actions
    };
  });

  return {
    ...decision,
    proposed_bundles: nextBundles
  };
}

type CoerceContext = {
  nationIds: Set<string>;
  provinceIds: Set<string>;
  officeIds: Set<string>;
  characterIds: Set<string>;
  playerNationId: string;
  nonPlayerNationId: string;
  playerProvinceId?: string;
  playerOfficeId?: string;
  fallbackCharacterId?: string;
  appointmentByOffice: Map<string, string>;
};

function coerceAction(action: Action, ctx: CoerceContext): Action | null {
  const params = { ...action.params } as Record<string, unknown>;

  coerceId(params, "target_nation_id", ctx.nationIds, ctx.nonPlayerNationId);
  coerceId(params, "nation_id", ctx.nationIds, ctx.playerNationId);
  coerceId(params, "province_id", ctx.provinceIds, ctx.playerProvinceId);
  coerceId(params, "from_province_id", ctx.provinceIds, ctx.playerProvinceId);
  coerceId(params, "to_province_id", ctx.provinceIds, ctx.playerProvinceId);

  coerceId(params, "office_id", ctx.officeIds, ctx.playerOfficeId);

  if (params.office_id && typeof params.office_id === "string") {
    const officeId = params.office_id;
    const appointed = ctx.appointmentByOffice.get(officeId);
    if (appointed && ctx.characterIds.has(appointed)) {
      params.character_id = params.character_id ?? appointed;
    }
  }

  coerceId(params, "character_id", ctx.characterIds, ctx.fallbackCharacterId);
  coerceId(params, "chair_character_id", ctx.characterIds, ctx.fallbackCharacterId);

  if (Array.isArray(params.relation_deltas)) {
    params.relation_deltas = params.relation_deltas
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const next = { ...(entry as Record<string, unknown>) };
        coerceId(next, "from_nation_id", ctx.nationIds, ctx.playerNationId);
        coerceId(next, "target_nation_id", ctx.nationIds, ctx.nonPlayerNationId);
        return next;
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const candidate: Action = { ...action, params } as Action;
  const parsed = ActionSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return null;
}

function coerceId(
  params: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
  fallback?: string
): void {
  const value = params[key];
  if (typeof value === "string" && allowed.has(value)) return;
  if (fallback) params[key] = fallback;
}
