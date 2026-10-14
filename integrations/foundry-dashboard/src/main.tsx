import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { AppQueryProvider, createAppQueryClient } from "@/lib/query-client";
import { ThemeProvider } from "@/components/ui/theme";
import { router } from "@/router";

import "./index.css";

// Single QueryClient at module scope, shared across the app tree.
const queryClient = createAppQueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element missing in index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <AppQueryProvider client={queryClient}>
        <RouterProvider router={router} />
      </AppQueryProvider>
    </ThemeProvider>
  </StrictMode>,
);
