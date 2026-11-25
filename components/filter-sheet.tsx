"use client";

import { useId, useRef, type ReactNode } from "react";
import { Icon } from "./icons";
import { buttonClass } from "./ui";

// A "Filters" button that opens its fields in a bottom sheet on phones (a centred dialog from sm up).
// Place it inside a GET <form>: the dialog stays a DOM child of the form, so its fields submit with it.
export function FilterSheet({ active, footer, children }: { active: number; footer: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`${buttonClass.secondary} shrink-0 px-3`}>
        <Icon name="filter" className="size-4" />
        Filters
        {active > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-teal-700 text-[11px] font-semibold text-white">{active}</span>
        )}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-zinc-200 p-0 shadow-xl backdrop:bg-zinc-900/40 sm:m-auto sm:max-w-md sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-zinc-900">
            Filters
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className="-mr-2 min-h-11 px-2 text-sm font-medium text-zinc-500 hover:text-zinc-900">
            Close
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">{footer}</div>
      </dialog>
    </>
  );
}
