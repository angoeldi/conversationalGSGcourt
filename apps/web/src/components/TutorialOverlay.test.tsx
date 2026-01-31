import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TutorialOverlay from "./TutorialOverlay";
import { AppProvider } from "../state/appStore";
import { buildScenarioViewModel } from "../test/fixtures";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchScenarioDefault: vi.fn()
  };
});

const mockedApi = vi.mocked(api, true);

describe("TutorialOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedApi.fetchScenarioDefault.mockResolvedValue(buildScenarioViewModel());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("auto-opens on the first turn when not dismissed", async () => {
    render(
      <AppProvider>
        <TutorialOverlay />
      </AppProvider>
    );

    expect(await screen.findByText("Realm Map")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of/i)).toBeInTheDocument();
  });

  it("can be restarted from the info button", async () => {
    localStorage.setItem("thecourt_tutorial_dismissed_v1", "1");

    render(
      <AppProvider>
        <TutorialOverlay />
      </AppProvider>
    );

    await waitFor(() => {
      expect(mockedApi.fetchScenarioDefault).toHaveBeenCalled();
    });

    expect(screen.queryByText("Realm Map")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /open tutorial/i }));
    expect(await screen.findByText("Realm Map")).toBeInTheDocument();
  });
});
