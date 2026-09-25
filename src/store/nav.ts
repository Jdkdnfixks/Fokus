import { create } from "zustand";
import type { ID } from "./types";

export type Page = "timer" | "calendar" | "tasks" | "modules" | "stats" | "music" | "settings";

interface NavState {
  page: Page;
  /** optionale Auswahl, z. B. ein Modul, das auf der Modulseite geöffnet werden soll */
  focusId: ID | null;
  navigate(page: Page, focusId?: ID | null): void;
}

export const useNav = create<NavState>()((set) => ({
  page: "timer",
  focusId: null,
  navigate(page, focusId = null) {
    set({ page, focusId });
  },
}));
