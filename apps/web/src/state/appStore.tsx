import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import type { DecisionParseOutput, TaskContext } from "@thecourt/shared";
import { buildTaskContext, fetchScenarioDefault, type ChatMessage, type ScenarioViewModel, type TaskViewModel } from "../lib/api";

export type Stage = "discussion" | "no_objection" | "final";

export type QueuedDecision = {
  taskId: string;
  stage: Stage;
  playerText: string;
  decision: DecisionParseOutput;
  transcript: ChatMessage[];
  queuedAt: string;
};

type AppState = {
  scenario: ScenarioViewModel | null;
  tasks: TaskViewModel[];
  selectedTaskId: string | null;
  selectedCourtiers: string[];
  selectedRegionId: string | null;
  chatByTask: Record<string, ChatMessage[]>;
  stage: Stage;
  decisionQueue: QueuedDecision[];
  resolvedTaskIds: string[];
  isChatLoading: boolean;
  error: string | null;
};

type Action =
  | { type: "scenario_loaded"; payload: ScenarioViewModel }
  | { type: "scenario_error"; payload: string }
  | { type: "select_task"; payload: string }
  | { type: "toggle_courtier"; payload: string }
  | { type: "set_courtiers"; payload: string[] }
  | { type: "select_region"; payload: string }
  | { type: "append_messages"; payload: { taskId: string; messages: ChatMessage[] } }
  | { type: "reset_task_chat"; payload: { taskId: string } }
  | { type: "set_stage"; payload: Stage }
  | { type: "queue_decision"; payload: QueuedDecision }
  | { type: "resolve_task"; payload: string }
  | { type: "clear_decision_queue" }
  | { type: "set_chat_loading"; payload: boolean };

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | undefined>(undefined);

const initialState: AppState = {
  scenario: null,
  tasks: [],
  selectedTaskId: null,
  selectedCourtiers: [],
  selectedRegionId: null,
  chatByTask: {},
  stage: "discussion",
  decisionQueue: [],
  resolvedTaskIds: [],
  isChatLoading: false,
  error: null
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "scenario_loaded": {
      const tasks = action.payload.tasks;
      const resolvedTaskIds = tasks.filter((task) => task.state !== "open").map((task) => task.taskId);
      const openTasks = tasks.filter((task) => task.state === "open");
      const selectedTaskId = openTasks[0]?.taskId ?? null;
      const defaultCourtiers = selectDefaultCourtiers(openTasks[0]);
      const defaultRegion = null;
      const chatByTask = buildInitialChatByTask(openTasks);
      return {
        ...state,
        scenario: action.payload,
        tasks,
        selectedTaskId,
        selectedCourtiers: defaultCourtiers,
        selectedRegionId: defaultRegion,
        chatByTask,
        decisionQueue: [],
        resolvedTaskIds,
        error: null
      };
    }
    case "scenario_error":
      return { ...state, error: action.payload };
    case "select_task": {
      const selectedTask = state.tasks.find((task) => task.taskId === action.payload);
      if (!selectedTask || state.resolvedTaskIds.includes(action.payload)) return state;
      return {
        ...state,
        selectedTaskId: action.payload,
        selectedCourtiers: selectDefaultCourtiers(selectedTask),
        chatByTask: ensureTaskChat(state.chatByTask, selectedTask),
        stage: "discussion"
      };
    }
    case "toggle_courtier": {
      const exists = state.selectedCourtiers.includes(action.payload);
      const selectedCourtiers = exists
        ? state.selectedCourtiers.filter((id) => id !== action.payload)
        : [...state.selectedCourtiers, action.payload];
      return { ...state, selectedCourtiers };
    }
    case "set_courtiers":
      return { ...state, selectedCourtiers: action.payload };
    case "select_region":
      return { ...state, selectedRegionId: action.payload };
    case "append_messages": {
      const existing = state.chatByTask[action.payload.taskId] ?? [];
      return {
        ...state,
        chatByTask: {
          ...state.chatByTask,
          [action.payload.taskId]: [...existing, ...action.payload.messages]
        }
      };
    }
    case "reset_task_chat": {
      const task = state.tasks.find((entry) => entry.taskId === action.payload.taskId);
      if (!task) return state;
      return {
        ...state,
        chatByTask: {
          ...state.chatByTask,
          [task.taskId]: [buildPetitionMessage(task)]
        }
      };
    }
    case "set_stage":
      return { ...state, stage: action.payload };
    case "queue_decision": {
      const existing = state.decisionQueue.filter((entry) => entry.taskId !== action.payload.taskId);
      const resolved = new Set(state.resolvedTaskIds);
      resolved.add(action.payload.taskId);
      const openTasks = state.tasks.filter((task) => !resolved.has(task.taskId));
      const nextTask = openTasks[0] ?? null;
      const selectedTaskId = state.selectedTaskId === action.payload.taskId ? nextTask?.taskId ?? null : state.selectedTaskId;
      return {
        ...state,
        decisionQueue: [...existing, action.payload],
        resolvedTaskIds: Array.from(resolved),
        selectedTaskId,
        selectedCourtiers: selectDefaultCourtiers(nextTask ?? undefined),
        stage: selectedTaskId ? "discussion" : state.stage
      };
    }
    case "resolve_task": {
      if (state.resolvedTaskIds.includes(action.payload)) return state;
      const resolved = [...state.resolvedTaskIds, action.payload];
      const openTasks = state.tasks.filter((task) => !resolved.includes(task.taskId));
      const nextTask = openTasks[0] ?? null;
      const selectedTaskId = state.selectedTaskId === action.payload ? nextTask?.taskId ?? null : state.selectedTaskId;
      return {
        ...state,
        resolvedTaskIds: resolved,
        selectedTaskId,
        selectedCourtiers: selectDefaultCourtiers(nextTask ?? undefined),
        stage: selectedTaskId ? "discussion" : state.stage
      };
    }
    case "clear_decision_queue":
      return { ...state, decisionQueue: [] };
    case "set_chat_loading":
      return { ...state, isChatLoading: action.payload };
    default:
      return state;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let active = true;
    fetchScenarioDefault()
      .then((data) => {
        if (active) dispatch({ type: "scenario_loaded", payload: data });
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: "scenario_error", payload: message });
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppState must be used within AppProvider");
  return context;
}

export function getSelectedTask(state: AppState): TaskViewModel | null {
  if (!state.selectedTaskId) return null;
  if (state.resolvedTaskIds.includes(state.selectedTaskId)) return null;
  return state.tasks.find((task) => task.taskId === state.selectedTaskId) ?? null;
}

export function getOpenTasks(state: AppState): TaskViewModel[] {
  return state.tasks.filter((task) => !state.resolvedTaskIds.includes(task.taskId));
}

export function buildTaskContextForState(state: AppState): TaskContext | null {
  if (!state.scenario) return null;
  const task = getSelectedTask(state);
  if (!task) return null;
  const messages = state.chatByTask[task.taskId] ?? [];
  return buildTaskContext(task, state.scenario.playerNationId, messages);
}

function selectDefaultCourtiers(task: TaskViewModel | undefined): string[] {
  if (task?.ownerCharacterId) return [task.ownerCharacterId];
  return [];
}

function buildInitialChatByTask(tasks: TaskViewModel[]): Record<string, ChatMessage[]> {
  return tasks.reduce<Record<string, ChatMessage[]>>((acc, task) => {
    acc[task.taskId] = [buildPetitionMessage(task)];
    return acc;
  }, {});
}

function ensureTaskChat(chatByTask: Record<string, ChatMessage[]>, task: TaskViewModel | undefined): Record<string, ChatMessage[]> {
  if (!task) return chatByTask;
  if (chatByTask[task.taskId]) return chatByTask;
  return { ...chatByTask, [task.taskId]: [buildPetitionMessage(task)] };
}

function buildPetitionMessage(task: TaskViewModel): ChatMessage {
  return {
    role: "courtier",
    content: task.prompt,
    speakerCharacterId: task.ownerCharacterId
  };
}
