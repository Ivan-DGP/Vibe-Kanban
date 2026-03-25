import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  resolve: ((value: boolean) => void) | null;
  confirm: (opts: { title?: string; description: string }) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  title: "Are you sure?",
  description: "",
  resolve: null,
  confirm: ({ title, description }) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: title ?? "Are you sure?",
        description,
        resolve,
      });
    }),
  handleConfirm: () => {
    get().resolve?.(true);
    set({ open: false, resolve: null });
  },
  handleCancel: () => {
    get().resolve?.(false);
    set({ open: false, resolve: null });
  },
}));

export function useConfirm() {
  return useConfirmStore((s) => s.confirm);
}

export function ConfirmDialog() {
  const { open, title, description, handleConfirm, handleCancel } =
    useConfirmStore();

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
