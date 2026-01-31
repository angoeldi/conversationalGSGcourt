import MapPanel from "./components/MapPanel";
import CourtPanel from "./components/CourtPanel";
import ChatPanel from "./components/ChatPanel";
import ScenarioControls from "./components/ScenarioControls";
import TutorialOverlay from "./components/TutorialOverlay";
import ActionLogDock from "./components/ActionLogDock";
import DisclaimerCorner from "./components/DisclaimerCorner";
import { AppProvider } from "./state/appStore";

export default function App() {
  return (
    <AppProvider>
      <div className="top-bar">
        <div className="top-bar-left">
          <ScenarioControls variant="topbar" />
        </div>
        <div className="top-bar-right">
          <DisclaimerCorner />
          <TutorialOverlay />
        </div>
      </div>
      <div className="layout">
        <aside className="pane pane-map" data-tutorial-id="map-panel">
          <MapPanel />
        </aside>
        <main className="pane pane-court">
          <CourtPanel />
        </main>
        <aside className="pane pane-chat">
          <ChatPanel />
        </aside>
      </div>
      <ActionLogDock />
    </AppProvider>
  );
}
