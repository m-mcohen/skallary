// src/ui/lib/filed-toast.ts -- the message after each filing: "Filed Shell as Gas." with Undo, about 10 seconds. Sonner (the
// registry toast, @shadcn/sonner) pauses it while hovered, makes Undo a real
// button keyboard users reach, and stills its motion for reduced motion.
import { toast } from "sonner";

export const FILED_TOAST_MS = 10_000;

export function showFiled(text: string, undo: () => Promise<void>): void {
  toast(text, {
    duration: FILED_TOAST_MS,
    action: {
      label: "Undo",
      onClick: () => {
        undo().then(
          () => toast("Undone.", { duration: 4_000 }),
          (e: unknown) => toast(e instanceof Error ? e.message : String(e), { duration: 8_000 })
        );
      },
    },
  });
}
