"use client";

import { useActionState, useEffect, useId, useRef, useState, startTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, buttonClass, inputClass } from "./ui";

export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** A one-time link to show with a copy button. Lives only in this client state. */
  link?: string;
  /** Bumped on every successful submit, so forms can react (reset, close) once per success. */
  done?: number;
};

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

// A form bound to a Server Action that shows the action's error or success message.
// It submits through onSubmit instead of the action attribute, so React does not clear the
// fields when validation fails; pass resetOnSuccess for "add" forms that should empty afterwards.
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.done) formRef.current?.reset();
  }, [state.done, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      className={className}
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(formData));
      }}
    >
      <FormMessage state={state} />
      {children}
    </form>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) return <div className="mb-4"><Alert tone="error">{state.error}</Alert></div>;
  if (state.success)
    return (
      <div className="mb-4 space-y-2">
        <Alert tone="success">{state.success}</Alert>
        {state.link && <CopyLink link={state.link} />}
      </div>
    );
  return null;
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor="one-time-link">One-time link</label>
      <input id="one-time-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} />
      <button
        type="button"
        className={buttonClass.secondary}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setCopied(false); // clipboard blocked: the field stays selectable for manual copy
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: keyof typeof buttonClass;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={buttonClass[variant]}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

// Opens a modal asking the user to confirm before the enclosing form is submitted.
export function ConfirmSubmit({
  label,
  title,
  message,
  confirmLabel,
  variant = "dangerOutline",
  tone = "danger",
}: {
  label: string;
  title: string;
  message: string;
  confirmLabel: string;
  variant?: keyof typeof buttonClass;
  /** Style of the dialog's confirm button. Danger (red) unless the action is not destructive. */
  tone?: "danger" | "primary";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return (
    <>
      <button type="button" disabled={pending} onClick={() => setOpen(true)} className={buttonClass[variant]}>
        {pending ? "Working…" : label}
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby={titleId}
        // A bottom sheet on phones (thumb reach), a centred dialog from sm up.
        className="mx-0 mt-auto mb-0 w-full max-w-none rounded-t-2xl border border-zinc-200 p-0 shadow-xl backdrop:bg-zinc-900/40 sm:m-auto sm:max-w-sm sm:rounded-xl"
      >
        <div className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
          <h2 id={titleId} className="text-base font-semibold text-zinc-900">
            {title}
          </h2>
          <p className="mt-2 text-sm text-zinc-600">{message}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button type="button" autoFocus onClick={() => setOpen(false)} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" onClick={() => setOpen(false)} className={buttonClass[tone]}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
