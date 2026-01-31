import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearUserAuth,
  createScenarioFromBuilder,
  loadLlmOverrides,
  loadUserAuth,
  loginUser,
  logoutUser,
  promoteGuest,
  refreshScenario,
  registerUser,
  saveGameId,
  saveLlmOverrides,
  saveUserAuth,
  type ImageProfile,
  type ImageProviderName,
  type LlmOverrides,
  type LlmProfile,
  type LlmProviderName,
  type UserAuth
} from "../lib/api";
import { useAppState } from "../state/appStore";

type ScenarioForm = {
  name: string;
  startDate: string;
  playerPolity: string;
  regionFocus: string;
  geoPackId: string;
  geoPackVersion: string;
  extraQueries: string;
};

type LlmOverrideDraft = {
  enabled: boolean;
  provider: LlmProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
};

type ImageOverrideDraft = {
  enabled: boolean;
  provider: ImageProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
};

type OverrideDrafts = {
  chat: LlmOverrideDraft;
  decision: LlmOverrideDraft;
  builder: LlmOverrideDraft;
  images: ImageOverrideDraft;
};

const DEFAULT_FORM: ScenarioForm = {
  name: "",
  startDate: "1492-01-01",
  playerPolity: "",
  regionFocus: "",
  geoPackId: "ne_admin1_v1",
  geoPackVersion: "1",
  extraQueries: ""
};

type LlmOverrideKey = "chat" | "decision" | "builder";

const LLM_OVERRIDE_LABELS: Record<LlmOverrideKey, string> = {
  chat: "Chat",
  decision: "Decision",
  builder: "Scenario builder"
};

const LLM_OVERRIDE_ENTRIES: Array<{ key: LlmOverrideKey; title: string; description: string }> = [
  {
    key: "chat",
    title: "Chat model",
    description: "Used for court conversations."
  },
  {
    key: "decision",
    title: "Decision model",
    description: "Used to parse rulings and queue decisions."
  },
  {
    key: "builder",
    title: "Scenario builder",
    description: "Used for new scenario generation."
  }
];

type ScenarioControlsProps = {
  variant?: "panel" | "topbar";
};

export default function ScenarioControls({ variant = "panel" }: ScenarioControlsProps) {
  const { state, dispatch } = useAppState();
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const [userAuth, setUserAuth] = useState<UserAuth | null>(() => loadUserAuth());
  const [userDraft, setUserDraft] = useState(() => ({
    email: userAuth?.isGuest ? "" : userAuth?.email ?? "",
    password: "",
    displayName: userAuth?.isGuest ? "" : userAuth?.displayName ?? ""
  }));
  const [userNote, setUserNote] = useState<string | null>(null);
  const [userBusy, setUserBusy] = useState(false);

  const [overrides, setOverrides] = useState<LlmOverrides>(() => loadLlmOverrides());
  const [overrideDrafts, setOverrideDrafts] = useState<OverrideDrafts>(() => buildDrafts(overrides));
  const [overrideNote, setOverrideNote] = useState<string | null>(null);
  const [pendingByokFocus, setPendingByokFocus] = useState(false);
  const byokRef = useRef<HTMLDivElement | null>(null);

  const [form, setForm] = useState<ScenarioForm>(DEFAULT_FORM);
  const [buildNote, setBuildNote] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const connectionLabel = buildOverrideSummary(overrides);
  const userLabel = userAuth?.isGuest
    ? "Guest session active"
    : userAuth?.email
      ? `Signed in as ${userAuth.email}`
      : "Not signed in";


  useEffect(() => {
    setUserAuth(loadUserAuth());
  }, [state.scenario]);

  useEffect(() => {
    if (!userAuth) return;
    setUserDraft((prev) => ({
      ...prev,
      email: userAuth.isGuest ? "" : userAuth.email ?? "",
      displayName: userAuth.isGuest ? "" : userAuth.displayName ?? ""
    }));
  }, [userAuth]);

  useEffect(() => {
    if (!expanded || !pendingByokFocus) return;
    const target = byokRef.current;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingByokFocus(false);
  }, [expanded, pendingByokFocus]);

  const extraQueries = useMemo(() => {
    if (!form.extraQueries.trim()) return [];
    return form.extraQueries
      .split(/[\n,]/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }, [form.extraQueries]);

  async function handleRefresh() {
    if (!state.scenario || refreshing) return;
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const updated = await refreshScenario(state.scenario.gameId);
      dispatch({ type: "scenario_loaded", payload: updated });
      setRefreshNote("Scenario refreshed.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRefreshNote(message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUserLogin() {
    if (userBusy) return;
    const email = userDraft.email.trim();
    const password = userDraft.password;
    if (!email || !password) {
      setUserNote("Enter email and password.");
      return;
    }
    setUserBusy(true);
    setUserNote(null);
    try {
      const authResult = await loginUser({ email, password });
      saveUserAuth(authResult);
      setUserAuth(authResult);
      setUserDraft((prev) => ({ ...prev, password: "" }));
      saveGameId(null);
      const updated = await refreshScenario(null);
      dispatch({ type: "scenario_loaded", payload: updated });
      setUserNote("Signed in.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUserNote(message);
    } finally {
      setUserBusy(false);
    }
  }

  async function handleUserRegister() {
    if (userBusy) return;
    const email = userDraft.email.trim();
    const password = userDraft.password;
    const displayName = userDraft.displayName.trim();
    if (!email || !password) {
      setUserNote("Enter email and password.");
      return;
    }
    setUserBusy(true);
    setUserNote(null);
    try {
      const authResult = await registerUser({
        email,
        password,
        display_name: displayName ? displayName : undefined
      });
      saveUserAuth(authResult);
      setUserAuth(authResult);
      setUserDraft((prev) => ({ ...prev, password: "" }));
      saveGameId(null);
      const updated = await refreshScenario(null);
      dispatch({ type: "scenario_loaded", payload: updated });
      setUserNote("Account created.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUserNote(message);
    } finally {
      setUserBusy(false);
    }
  }

  async function handleUserLogout() {
    if (userBusy) return;
    setUserBusy(true);
    setUserNote(null);
    let hadError = false;
    try {
      await logoutUser();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUserNote(message);
      hadError = true;
    } finally {
      clearUserAuth();
      setUserAuth(null);
      setUserDraft((prev) => ({ ...prev, password: "" }));
      saveGameId(null);
      try {
        const updated = await refreshScenario(null);
        dispatch({ type: "scenario_loaded", payload: updated });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRefreshNote(message);
      }
      if (!hadError) setUserNote("Signed out.");
      setUserBusy(false);
    }
  }

  async function handleGuestPromote() {
    if (userBusy) return;
    const email = userDraft.email.trim();
    const password = userDraft.password;
    const displayName = userDraft.displayName.trim();
    if (!email || !password) {
      setUserNote("Enter email and password.");
      return;
    }
    setUserBusy(true);
    setUserNote(null);
    try {
      const authResult = await promoteGuest({
        email,
        password,
        display_name: displayName ? displayName : undefined
      });
      saveUserAuth(authResult);
      setUserAuth(authResult);
      setUserDraft((prev) => ({ ...prev, password: "" }));
      setUserNote("Account promoted.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUserNote(message);
    } finally {
      setUserBusy(false);
    }
  }

  function handleSaveLlmOverride(key: LlmOverrideKey) {
    const nextProfile = draftToLlmProfile(overrideDrafts[key]);
    const nextOverrides = { ...overrides, [key]: nextProfile };
    setOverrides(nextOverrides);
    saveLlmOverrides(nextOverrides);
    setOverrideDrafts((prev) => ({ ...prev, [key]: buildLlmDraft(nextProfile) }));
    setOverrideNote(`${LLM_OVERRIDE_LABELS[key]} override saved.`);
  }

  function handleClearLlmOverride(key: LlmOverrideKey) {
    const resetDraft = defaultLlmDraft();
    const nextOverrides = { ...overrides, [key]: draftToLlmProfile(resetDraft) };
    setOverrides(nextOverrides);
    saveLlmOverrides(nextOverrides);
    setOverrideDrafts((prev) => ({ ...prev, [key]: resetDraft }));
    setOverrideNote(`${LLM_OVERRIDE_LABELS[key]} override cleared.`);
  }

  function handleSaveImageOverride() {
    const nextProfile = draftToImageProfile(overrideDrafts.images);
    const nextOverrides = { ...overrides, images: nextProfile };
    setOverrides(nextOverrides);
    saveLlmOverrides(nextOverrides);
    setOverrideDrafts((prev) => ({ ...prev, images: buildImageDraft(nextProfile) }));
    setOverrideNote("Image override saved.");
  }

  function handleClearImageOverride() {
    const resetDraft = defaultImageDraft();
    const nextOverrides = { ...overrides, images: draftToImageProfile(resetDraft) };
    setOverrides(nextOverrides);
    saveLlmOverrides(nextOverrides);
    setOverrideDrafts((prev) => ({ ...prev, images: resetDraft }));
    setOverrideNote("Image override cleared.");
  }

  function handleOpenByok() {
    if (!expanded) setExpanded(true);
    setPendingByokFocus(true);
  }

  async function handleCreateScenario() {
    if (building) return;
    if (!form.name.trim() || !form.startDate.trim() || !form.playerPolity.trim() || !form.regionFocus.trim()) {
      setBuildNote("Fill in name, start date, player polity, and region focus.");
      return;
    }
    setBuilding(true);
    setBuildNote(null);
    try {
      const viewModel = await createScenarioFromBuilder({
        name: form.name.trim(),
        start_date: form.startDate.trim(),
        player_polity: form.playerPolity.trim(),
        region_focus: form.regionFocus.trim(),
        geo_pack_id: form.geoPackId.trim() || undefined,
        geo_pack_version: form.geoPackVersion.trim() || undefined,
        extra_wiki_queries: extraQueries
      });
      dispatch({ type: "scenario_loaded", payload: viewModel });
      setBuildNote("Scenario created.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBuildNote(message);
    } finally {
      setBuilding(false);
    }
  }

  const containerClassName = `card scenario-controls${variant === "topbar" ? " scenario-controls-topbar" : ""}`;

  return (
    <div className={containerClassName}>
      <div className="scenario-controls-header">
        <div>
          <div className="section-title">Session &amp; Scenario</div>
          <div className="small">{connectionLabel}</div>
        </div>
        <div className="row">
          <button
            className="btn ghost small"
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Manage"}
          </button>
          <button className="btn small" type="button" onClick={handleOpenByok}>
            Bring your keys
          </button>
          <button className="btn small" type="button" onClick={handleRefresh} disabled={refreshing || !state.scenario}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {refreshNote && <div className="small">{refreshNote}</div>}

      {expanded && (
        <div className="scenario-controls-body">
          <div className="scenario-section">
            <div className="section-title">Player session</div>
            <div className="small">{userLabel}</div>
            {userAuth?.isGuest ? (
              <>
                <div className="small">Guest sessions are stored server-side but not linked to an email.</div>
                <div className="scenario-grid">
                  <label className="field">
                    <span>Email</span>
                    <input
                      className="text-input"
                      type="email"
                      value={userDraft.email}
                      onChange={(event) => setUserDraft((prev) => ({ ...prev, email: event.target.value }))}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <input
                      className="text-input"
                      type="password"
                      value={userDraft.password}
                      onChange={(event) => setUserDraft((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="Minimum 8 characters"
                    />
                  </label>
                  <label className="field">
                    <span>Display name (optional)</span>
                    <input
                      className="text-input"
                      type="text"
                      value={userDraft.displayName}
                      onChange={(event) => setUserDraft((prev) => ({ ...prev, displayName: event.target.value }))}
                      placeholder="Ruler name"
                    />
                  </label>
                </div>
                <div className="row">
                  <button className="btn primary small" type="button" onClick={handleGuestPromote} disabled={userBusy}>
                    {userBusy ? "Promoting..." : "Promote guest"}
                  </button>
                  <button className="btn ghost small" type="button" onClick={handleUserLogout} disabled={userBusy}>
                    {userBusy ? "Signing out..." : "New guest"}
                  </button>
                  {userNote && <span className="small">{userNote}</span>}
                </div>
              </>
            ) : userAuth ? (
              <div className="row">
                <button className="btn ghost small" type="button" onClick={handleUserLogout} disabled={userBusy}>
                  {userBusy ? "Signing out..." : "Log out"}
                </button>
                {userNote && <span className="small">{userNote}</span>}
              </div>
            ) : (
              <>
                <div className="scenario-grid">
                  <label className="field">
                    <span>Email</span>
                    <input
                      className="text-input"
                      type="email"
                      value={userDraft.email}
                      onChange={(event) => setUserDraft((prev) => ({ ...prev, email: event.target.value }))}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <input
                      className="text-input"
                      type="password"
                      value={userDraft.password}
                      onChange={(event) => setUserDraft((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="Minimum 8 characters"
                    />
                  </label>
                  <label className="field">
                    <span>Display name (optional)</span>
                    <input
                      className="text-input"
                      type="text"
                      value={userDraft.displayName}
                      onChange={(event) => setUserDraft((prev) => ({ ...prev, displayName: event.target.value }))}
                      placeholder="Ruler name"
                    />
                  </label>
                </div>
                <div className="row">
                  <button className="btn primary small" type="button" onClick={handleUserLogin} disabled={userBusy}>
                    {userBusy ? "Signing in..." : "Log in"}
                  </button>
                  <button className="btn ghost small" type="button" onClick={handleUserRegister} disabled={userBusy}>
                    Register
                  </button>
                  {userNote && <span className="small">{userNote}</span>}
                </div>
              </>
            )}
          </div>

          <div className="scenario-section" ref={byokRef}>
            <div className="section-title">Bring your own keys</div>
            <div className="small">Overrides are stored locally and sent per request. Leave disabled to use server defaults.</div>

            {LLM_OVERRIDE_ENTRIES.map((entry) => {
              const draft = overrideDrafts[entry.key];
              const missingKey = draft.enabled && !draft.apiKey.trim();
              return (
                <div className="card compact" key={entry.key}>
                  <div className="section-title">{entry.title}</div>
                  <div className="small">{entry.description}</div>
                  <div className="small">{formatLlmEffectiveLabel(LLM_OVERRIDE_LABELS[entry.key], overrides[entry.key])}</div>
                  <div className="row">
                    <label className="small">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [entry.key]: { ...prev[entry.key], enabled: event.target.checked }
                          }))
                        }
                      />{" "}
                      Enable override
                    </label>
                    {missingKey && <span className="small">No API key set (server key will be used if configured).</span>}
                  </div>
                  <div className="scenario-grid">
                    <label className="field">
                      <span>Provider</span>
                      <select
                        className="text-input"
                        value={draft.provider}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [entry.key]: { ...prev[entry.key], provider: event.target.value as LlmProviderName }
                          }))
                        }
                      >
                        <option value="openai">OpenAI</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="groq">Groq</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>API key</span>
                      <input
                        className="text-input"
                        type="password"
                        value={draft.apiKey}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [entry.key]: { ...prev[entry.key], apiKey: event.target.value }
                          }))
                        }
                        placeholder="sk-..."
                      />
                    </label>
                    <label className="field">
                      <span>Model (optional)</span>
                      <input
                        className="text-input"
                        type="text"
                        value={draft.model}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [entry.key]: { ...prev[entry.key], model: event.target.value }
                          }))
                        }
                        placeholder="Leave blank for default"
                      />
                    </label>
                    <label className="field">
                      <span>Base URL (optional)</span>
                      <input
                        className="text-input"
                        type="text"
                        value={draft.baseUrl}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [entry.key]: { ...prev[entry.key], baseUrl: event.target.value }
                          }))
                        }
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                  </div>
                  <div className="row">
                    <button className="btn primary small" type="button" onClick={() => handleSaveLlmOverride(entry.key)}>
                      Save override
                    </button>
                    <button className="btn ghost small" type="button" onClick={() => handleClearLlmOverride(entry.key)}>
                      Clear
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="card compact">
              <div className="section-title">Image generation</div>
              <div className="small">Portrait generation provider (OpenAI or Hugging Face).</div>
              <div className="small">{formatImageEffectiveLabel(overrides.images)}</div>
              <div className="row">
                <label className="small">
                  <input
                    type="checkbox"
                    checked={overrideDrafts.images.enabled}
                    onChange={(event) =>
                      setOverrideDrafts((prev) => ({
                        ...prev,
                        images: { ...prev.images, enabled: event.target.checked }
                      }))
                    }
                  />{" "}
                  Enable override
                </label>
                {overrideDrafts.images.enabled && !overrideDrafts.images.apiKey.trim() && (
                  <span className="small">No API key set (server key will be used if configured).</span>
                )}
              </div>
              <div className="scenario-grid">
                <label className="field">
                  <span>Provider</span>
                  <select
                    className="text-input"
                    value={overrideDrafts.images.provider}
                    onChange={(event) =>
                      setOverrideDrafts((prev) => ({
                        ...prev,
                        images: { ...prev.images, provider: event.target.value as ImageProviderName }
                      }))
                    }
                  >
                    <option value="openai">OpenAI</option>
                    <option value="hf">Hugging Face</option>
                  </select>
                </label>
                <label className="field">
                  <span>API key</span>
                  <input
                    className="text-input"
                    type="password"
                    value={overrideDrafts.images.apiKey}
                    onChange={(event) =>
                      setOverrideDrafts((prev) => ({
                        ...prev,
                        images: { ...prev.images, apiKey: event.target.value }
                      }))
                    }
                    placeholder="hf_... or sk-..."
                  />
                </label>
                <label className="field">
                  <span>Model (optional)</span>
                  <input
                    className="text-input"
                    type="text"
                    value={overrideDrafts.images.model}
                    onChange={(event) =>
                      setOverrideDrafts((prev) => ({
                        ...prev,
                        images: { ...prev.images, model: event.target.value }
                      }))
                    }
                    placeholder="Leave blank for default"
                  />
                </label>
                <label className="field">
                  <span>Base URL (optional)</span>
                  <input
                    className="text-input"
                    type="text"
                    value={overrideDrafts.images.baseUrl}
                    onChange={(event) =>
                      setOverrideDrafts((prev) => ({
                        ...prev,
                        images: { ...prev.images, baseUrl: event.target.value }
                      }))
                    }
                    placeholder="https://router.huggingface.co/hf-inference/models/..."
                  />
                </label>
              </div>
              <div className="row">
                <button className="btn primary small" type="button" onClick={handleSaveImageOverride}>
                  Save override
                </button>
                <button className="btn ghost small" type="button" onClick={handleClearImageOverride}>
                  Clear
                </button>
              </div>
            </div>

            {overrideNote && <div className="small">{overrideNote}</div>}
          </div>

          <div className="scenario-section">
            <div className="row" style={{ alignItems: "center", gap: 8 }}>
              <div className="section-title">Create new scenario</div>
              <span className="badge hot">Experimental</span>
            </div>
            <div className="small">Uses the builder override if enabled, otherwise server defaults. Scenario creation is experimental.</div>
            <div className="scenario-grid">
              <label className="field">
                <span>Name</span>
                <input
                  className="text-input"
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="The English Crown, 1492"
                />
              </label>
              <label className="field">
                <span>Start date</span>
                <input
                  className="text-input"
                  type="text"
                  value={form.startDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
                  placeholder="1492-01-01"
                />
              </label>
              <label className="field">
                <span>Player polity</span>
                <input
                  className="text-input"
                  type="text"
                  value={form.playerPolity}
                  onChange={(event) => setForm((prev) => ({ ...prev, playerPolity: event.target.value }))}
                  placeholder="Kingdom of England"
                />
              </label>
              <label className="field">
                <span>Region focus</span>
                <input
                  className="text-input"
                  type="text"
                  value={form.regionFocus}
                  onChange={(event) => setForm((prev) => ({ ...prev, regionFocus: event.target.value }))}
                  placeholder="British Isles"
                />
              </label>
              <label className="field">
                <span>Geo pack ID</span>
                <input
                  className="text-input"
                  type="text"
                  value={form.geoPackId}
                  onChange={(event) => setForm((prev) => ({ ...prev, geoPackId: event.target.value }))}
                  placeholder="ne_admin1_v1"
                />
              </label>
              <label className="field">
                <span>Geo pack version</span>
                <input
                  className="text-input"
                  type="text"
                  value={form.geoPackVersion}
                  onChange={(event) => setForm((prev) => ({ ...prev, geoPackVersion: event.target.value }))}
                  placeholder="1"
                />
              </label>
              <label className="field field-wide">
                <span>Extra wiki queries (optional)</span>
                <textarea
                  className="text-input text-area"
                  value={form.extraQueries}
                  onChange={(event) => setForm((prev) => ({ ...prev, extraQueries: event.target.value }))}
                  placeholder="Comma or newline separated topics"
                />
              </label>
            </div>
            <div className="row">
              <button className="btn primary small" type="button" disabled={building} onClick={handleCreateScenario}>
                {building ? "Creating..." : "Create scenario"}
              </button>
              {buildNote && <span className="small">{buildNote}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildDrafts(overrides: LlmOverrides): OverrideDrafts {
  return {
    chat: buildLlmDraft(overrides.chat),
    decision: buildLlmDraft(overrides.decision),
    builder: buildLlmDraft(overrides.builder),
    images: buildImageDraft(overrides.images)
  };
}

function buildLlmDraft(profile: LlmProfile): LlmOverrideDraft {
  return {
    enabled: profile.enabled,
    provider: profile.provider,
    apiKey: profile.apiKey ?? "",
    model: profile.model ?? "",
    baseUrl: profile.baseUrl ?? ""
  };
}

function buildImageDraft(profile: ImageProfile): ImageOverrideDraft {
  return {
    enabled: profile.enabled,
    provider: profile.provider,
    apiKey: profile.apiKey ?? "",
    model: profile.model ?? "",
    baseUrl: profile.baseUrl ?? ""
  };
}

function draftToLlmProfile(draft: LlmOverrideDraft): LlmProfile {
  const apiKey = draft.apiKey.trim();
  const model = draft.model.trim();
  const baseUrl = draft.baseUrl.trim();
  return {
    enabled: draft.enabled,
    provider: draft.provider,
    apiKey: apiKey || undefined,
    model: model || undefined,
    baseUrl: baseUrl || undefined
  };
}

function draftToImageProfile(draft: ImageOverrideDraft): ImageProfile {
  const apiKey = draft.apiKey.trim();
  const model = draft.model.trim();
  const baseUrl = draft.baseUrl.trim();
  return {
    enabled: draft.enabled,
    provider: draft.provider,
    apiKey: apiKey || undefined,
    model: model || undefined,
    baseUrl: baseUrl || undefined
  };
}

function defaultLlmDraft(provider: LlmProviderName = "openai"): LlmOverrideDraft {
  return {
    enabled: false,
    provider,
    apiKey: "",
    model: "",
    baseUrl: ""
  };
}

function defaultImageDraft(provider: ImageProviderName = "openai"): ImageOverrideDraft {
  return {
    enabled: false,
    provider,
    apiKey: "",
    model: "",
    baseUrl: ""
  };
}

function buildOverrideSummary(overrides: LlmOverrides): string {
  const enabled = [
    overrides.chat.enabled,
    overrides.decision.enabled,
    overrides.builder.enabled,
    overrides.images.enabled
  ];
  if (!enabled.some(Boolean)) return "Using server defaults (if configured)";
  const parts = [
    `Chat: ${overrides.chat.enabled ? overrides.chat.provider : "server"}`,
    `Decision: ${overrides.decision.enabled ? overrides.decision.provider : "server"}`,
    `Builder: ${overrides.builder.enabled ? overrides.builder.provider : "server"}`,
    `Images: ${overrides.images.enabled ? overrides.images.provider : "server"}`
  ];
  return `Overrides → ${parts.join(" · ")}`;
}

function formatLlmEffectiveLabel(label: string, profile: LlmProfile): string {
  if (!profile.enabled) return `${label}: server defaults`;
  const model = profile.model ?? "default model";
  const baseUrl = formatBaseUrl(profile.baseUrl);
  const missingKey = !profile.apiKey?.trim();
  const keyNote = missingKey ? " (key missing)" : "";
  const baseNote = baseUrl ? ` @ ${baseUrl}` : "";
  return `${label}: ${profile.provider} / ${model}${baseNote}${keyNote}`;
}

function formatImageEffectiveLabel(profile: ImageProfile): string {
  if (!profile.enabled) return "Images: server defaults";
  const model = profile.model ?? "default model";
  const size = profile.size ? ` / ${profile.size}` : "";
  const baseUrl = formatBaseUrl(profile.baseUrl);
  const missingKey = !profile.apiKey?.trim();
  const keyNote = missingKey ? " (key missing)" : "";
  const baseNote = baseUrl ? ` @ ${baseUrl}` : "";
  return `Images: ${profile.provider} / ${model}${size}${baseNote}${keyNote}`;
}

function formatBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  try {
    const parsed = new URL(baseUrl);
    return parsed.host;
  } catch {
    const trimmed = baseUrl.trim();
    if (!trimmed) return null;
    if (trimmed.length <= 32) return trimmed;
    return `${trimmed.slice(0, 29)}...`;
  }
}
