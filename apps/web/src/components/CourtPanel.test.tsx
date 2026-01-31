import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import type { Dispatch } from "react";
import CourtPanel from "./CourtPanel";
import { AppProvider, useAppState } from "../state/appStore";
import { buildDecisionOutput, buildScenarioViewModel } from "../test/fixtures";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchScenarioDefault: vi.fn(),
    advanceWeek: vi.fn(),
    refreshScenario: vi.fn(),
    fetchPortrait: vi.fn()
  };
});

const mockedApi = vi.mocked(api, true);

function buildPortraitResponse(characterId: string): api.PortraitResponse {
  return {
    character_id: characterId,
    prompt: "Portrait prompt",
    provider: "openai",
    model: null,
    size: "512x512",
    mime: "image/png",
    b64: "abc",
    data_url: "data:image/png;base64,abc"
  };
}

function DispatchHarness({ onReady }: { onReady: (dispatch: Dispatch<any>) => void }) {
  const { state, dispatch } = useAppState();
  const fired = useRef(false);

  useEffect(() => {
    if (state.scenario && !fired.current) {
      fired.current = true;
      onReady(dispatch);
    }
  }, [state.scenario, dispatch, onReady]);

  return null;
}

describe("CourtPanel", () => {
  beforeEach(() => {
    mockedApi.fetchScenarioDefault.mockResolvedValue(buildScenarioViewModel());
    mockedApi.refreshScenario.mockResolvedValue(buildScenarioViewModel());
    mockedApi.fetchPortrait.mockImplementation(async (characterId: string) => buildPortraitResponse(characterId));
    mockedApi.advanceWeek.mockResolvedValue({
      turn_index: 2,
      processed_actions: 1,
      processed_decisions: 1,
      auto_decided_tasks: 0
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears queued decisions after ending the week", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <DispatchHarness
          onReady={(dispatch) => {
            dispatch({
              type: "queue_decision",
              payload: {
                taskId: "task-1",
                stage: "final",
                playerText: "Proceed.",
                decision: buildDecisionOutput("task-1"),
                transcript: [],
                queuedAt: "2026-01-27T00:00:00Z"
              }
            });
          }}
        />
        <CourtPanel />
      </AppProvider>
    );

    await screen.findByText("The Court");
    await screen.findByText("1 queued");

    await user.click(screen.getByRole("button", { name: /end the week/i }));

    await screen.findByText("Week advanced to 2.");
    expect(mockedApi.advanceWeek).toHaveBeenCalledWith({ auto_decide_open: false, gameId: "game-1" });
    expect(mockedApi.refreshScenario).toHaveBeenCalledWith("game-1");

    await waitFor(() => {
      expect(screen.queryByText("1 queued")).not.toBeInTheDocument();
    });
  });

  it("renders portraits for the ruler and courtiers", async () => {
    render(
      <AppProvider>
        <CourtPanel />
      </AppProvider>
    );

    await screen.findByAltText("Queen Ada portrait");
    await screen.findByAltText("Lord Byron portrait");

    expect(mockedApi.fetchPortrait).toHaveBeenCalledWith("char-queen", { gameId: "game-1" });
    expect(mockedApi.fetchPortrait).toHaveBeenCalledWith("char-1", { gameId: "game-1" });
  });
});
