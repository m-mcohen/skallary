import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ui/App";
import { getHouseholdUI } from "./ui/lib/db-setup";
import "./index.css";
import { startTheme } from "./ui/lib/theme";

startTheme();

// The household's names are read before the first screen draws, so every account name on
// every screen drops them (account-display.ts). Without a server the app still starts.
void getHouseholdUI()
  .catch(() => null)
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
