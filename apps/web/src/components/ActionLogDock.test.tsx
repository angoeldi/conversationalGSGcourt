import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActionLogDock from "./ActionLogDock";
import { AppProvider } from "../state/appStore";
import { buildScenarioViewModel } from "../test/fixtures";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchScenarioDefault: vi.fn(),
    fetchActionLog: vi.fn()
  };
});

const mockedApi = vi.mocked(api, true);

function buildActionLogEntry(overrides?: Partial<api.ActionEffectLogEntry>): api.ActionEffectLogEntry {
  return {
    effect_id: "effect-1",
    effect_type: "action.noop",
    delta: {},
    audit: {},
    created_at: "2026-01-27T00:00:00Z",
    action_id: "action-1",
    action_type: "noop",
    turn_index: 1,
    turn_date: "2026-01-27T00:00:00Z",
    ...overrides
  };
}

describe("ActionLogDock", () => {
  beforeEach(() => {
    mockedApi.fetchScenarioDefault.mockResolvedValue(buildScenarioViewModel());
    mockedApi.fetchActionLog.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("paginates the action log", async () => {
    const user = userEvent.setup();
    const pageSize = 50;
    const firstPage = Array.from({ length: pageSize }, (_, index) =>
      buildActionLogEntry({ effect_id: `effect-${index}`, created_at: `2026-01-27T00:00:${index.toString().padStart(2, "0")}Z` })
    );
    const secondPage = [
      buildActionLogEntry({ effect_id: "effect-51", created_at: "2026-01-26T00:00:00Z" })
    ];
    mockedApi.fetchActionLog.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    render(
      <AppProvider>
        <ActionLogDock />
      </AppProvider>
    );

    await screen.findByText("Action Log");
    await waitFor(() => {
      expect(mockedApi.fetchActionLog).toHaveBeenCalledWith(pageSize, 0, "game-1");
    });

    const loadMore = await screen.findByRole("button", { name: /load more/i });
    await user.click(loadMore);

    await waitFor(() => {
      expect(mockedApi.fetchActionLog).toHaveBeenLastCalledWith(pageSize, pageSize, "game-1");
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    });
  });

  it("formats action log entries with nation names", async () => {
    mockedApi.fetchActionLog.mockResolvedValueOnce([
      buildActionLogEntry({
        effect_id: "effect-envoy",
        effect_type: "diplomacy.envoy_sent",
        action_type: "send_envoy",
        delta: {
          target_nation_id: "nation-2",
          relation_delta: 3,
          topic: "trade"
        },
        audit: { offer: "grain" }
      })
    ]);

    render(
      <AppProvider>
        <ActionLogDock />
      </AppProvider>
    );

    await screen.findByText(/Envoy sent to Byronia on trade/i);
  });
});
