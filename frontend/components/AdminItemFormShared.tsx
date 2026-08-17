"use client";
// Shared presentational primitives for the AdminItemForm steps.
// Extracted from ``AdminItemForm.tsx`` (issue #38, ADR-0004 / T11). Both
// step components render ``Field``/``ErrorBlock`` and style inputs with
// ``inputStyle``, so they live here to avoid the step files importing
// each other.
import React from "react";
export const inputStyle: React.CSSProperties = {
  width: "100%",
};
export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <span style={{ color: "#c00" }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}
export function ErrorBlock({ message }: { message: string }) {
  return (
    <div role="alert" className="error-panel">
      {message}
    </div>
  );
}
