"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/** Shared focus trap, Escape handling and focus restoration for menus and material drawers. */
export function AppDialog({ open, onOpenChange, trigger, title, description, toolbar, children, drawer = false, onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; trigger?: ReactNode;
  title: string; description: string; toolbar?: ReactNode; children: ReactNode; drawer?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
    <Dialog.Portal>
      <Dialog.Overlay className="app-dialog-overlay" />
      <Dialog.Content onCloseAutoFocus={onCloseAutoFocus} className={drawer ? "app-dialog app-drawer" : "app-dialog"}>
        <div className="app-dialog-heading">
          <div><Dialog.Title className="font-semibold">{title}</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">{description}</Dialog.Description></div>
          <Dialog.Close className="icon-button shrink-0" aria-label="关闭"><Icon name="close" /></Dialog.Close>
        </div>
        <div className="app-dialog-body">
          {toolbar && <div className="app-dialog-toolbar">{toolbar}</div>}
          <div className="app-dialog-inner">{children}</div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
