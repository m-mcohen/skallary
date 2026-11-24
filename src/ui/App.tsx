// src/ui/App.tsx
//
// The entry point, and nothing else. Everything this file used to do --
// navigation, sync state, scenario state, plan state, section dispatch, 638
// lines of it -- now lives in src/ui/shell/ and src/ui/lib/usePlanState.ts.
import AppShell from "./shell/AppShell";

export default function App() {
  return <AppShell />;
}
