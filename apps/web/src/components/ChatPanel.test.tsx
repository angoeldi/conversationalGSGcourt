import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "./ChatPanel";
import { AppProvider } from "../state/appStore";
import { buildScenarioViewModel } from "../test/fixtures";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchScenarioDefault: vi.fn(),
    requestCourtChat: vi.fn(),
    queueDecision: vi.fn()
  };
});

const mockedApi = vi.mocked(api, true);

describe("ChatPanel", () => {
  beforeEach(() => {
    mockedApi.fetchScenarioDefault.mockResolvedValue(buildScenarioViewModel());
    mockedApi.requestCourtChat.mockResolvedValue({
      task_id: "task-1",
      messages: [{ speaker_character_id: "char-1", content: "I advise yes." }]
    });
    mockedApi.queueDecision.mockResolvedValue({
      decision: {
        task_id: "task-1",
        intent_summary: "Test",
        proposed_bundles: [
          {
            label: "A",
            actions: [{ type: "adjust_tax_rate", params: { new_tax_rate: 0.4 } }],
            tradeoffs: []
          },
          {
            label: "B",
            actions: [{ type: "issue_debt", params: { amount: 1000, interest_rate_annual: 0.08, maturity_weeks: 52 } }],
            tradeoffs: []
          }
        ],
        clarifying_questions: [],
        assumptions: []
      },
      queued_actions: 1
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("switches message modes via the slider", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ChatPanel />
      </AppProvider>
    );

    await screen.findByText("Council Chamber");
    expect(screen.getByText("Discuss", { selector: ".badge" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Decide" }));
    expect(screen.getByText("Decide", { selector: ".badge" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Overrule" }));
    expect(screen.getByText("Overrule", { selector: ".badge" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Discuss" }));
    expect(screen.getByText("Discuss", { selector: ".badge" })).toBeInTheDocument();
  });

  it("fills a context-aware quick prompt", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ChatPanel />
      </AppProvider>
    );

    await screen.findByText("Council Chamber");

    const prompt = "What are the risks and tradeoffs of \"A petition about alliances.\"?";
    await user.click(screen.getByRole("button", { name: prompt }));
    expect(screen.getByRole("textbox")).toHaveValue(prompt);
  });

  it("clears the chat back to the petition message", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ChatPanel />
      </AppProvider>
    );

    await screen.findByText("Council Chamber");

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "We should proceed.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("I advise yes.");

    const clearButton = screen.getByRole("button", { name: /clear chat/i });
    expect(clearButton).toBeEnabled();
    await user.click(clearButton);

    await waitFor(() => {
      expect(screen.queryByText("I advise yes.")).not.toBeInTheDocument();
    });

    expect(screen.getAllByText("A petition about alliances.").length).toBeGreaterThan(0);
  });
});
