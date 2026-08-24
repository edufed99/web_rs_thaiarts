"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiClientError,
  getItem,
  postItemCommit,
  postItemDraft,
} from "@/lib/api";
import type { ItemDraft, ItemDraftOut } from "@/lib/types";
import { AdminItemFormDraftStep } from "./AdminItemFormDraftStep";
import { AdminItemFormReviewStep } from "./AdminItemFormReviewStep";
import { useCoverImage } from "./useCoverImage";
import { buildDraftBody, EMPTY_FIELDS, type DraftFields } from "./AdminItemFormHelpers";
type Step = "draft" | "review";
export function AdminItemForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("draft");
  const [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
  const [draftResult, setDraftResult] = useState<ItemDraftOut | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // ``saveMode`` lets the two submit buttons share the ``submitting`` flag
  // while showing different in-progress labels.
  const [saveMode, setSaveMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cover image preview + upload (issue #38). The picked file lives in the
  // draft-field state above; the hook reads/writes it through ``setFields``.
  const cover = useCoverImage({
    imageFile: fields.image_file,
    setImageFile: (file) => setFields((prev) => ({ ...prev, image_file: file })),
    onClearError: () => setError(null),
  });
  async function handleDraft(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaveMode(false);
    if (!fields.name.trim()) {
      setError("กรุณากรอกชื่อการแสดง");
      return;
    }
    setSubmitting(true);
    try {
      const body: ItemDraft = buildDraftBody(fields);
      const result = await postItemDraft(body);
      setDraftResult(result);
      // Pre-select all server proposals — the admin can prune them.
      const ids = new Set<number>();
      result.proposals.forEach((p) => ids.add(p.id));
      setSelectedIds(ids);
      setStep("review");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }
  /**
   * Skip Step 2 and commit directly with every server proposal accepted.
   * Useful when the admin trusts the auto/llm suggestions and just wants
   * to persist the row without reviewing the keyword checklist.
   */
  async function handleSave() {
    setError(null);
    setSaveMode(true);
    if (!fields.name.trim()) {
      setError("กรุณากรอกชื่อการแสดง");
      setSaveMode(false);
      return;
    }
    setSubmitting(true);
    try {
      const draft = await postItemDraft(buildDraftBody(fields));
      const newKeywords = (draft.proposals || [])
        .filter((p) => p.is_new || p.id < 0)
        .map((p) => ({ name: p.name, taxonomy_path: p.taxonomy_path }));
      const out = await postItemCommit({
        draft_id: draft.draft_id,
        additional_keyword_ids: [],
        removed_keyword_ids: [],
        new_keywords: newKeywords,
      });
      await cover.uploadCoverIfAny(out.item.id);
      try {
        await getItem(out.item.id);
      } catch {
        // ignore
      }
      router.push(`/items/${out.item.id}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
      setSaveMode(false);
    }
  }
  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!draftResult) return;
    setError(null);
    setSubmitting(true);
    try {
      const selectedProposals = draftResult.proposals.filter((p) => selectedIds.has(p.id));
      const newKeywords = selectedProposals
        .filter((p) => p.is_new || p.id < 0)
        .map((p) => ({ name: p.name, taxonomy_path: p.taxonomy_path }));

      const proposalIds = new Set(draftResult.proposals.map((p) => p.id));
      const allSelected = Array.from(selectedIds);
      const additional = allSelected.filter((id) => id > 0 && !proposalIds.has(id));
      const removed = draftResult.proposals
        .filter((p) => !p.is_new && p.id > 0)
        .map((p) => p.id)
        .filter((id) => !selectedIds.has(id));

      const out = await postItemCommit({
        draft_id: draftResult.draft_id,
        additional_keyword_ids: additional,
        removed_keyword_ids: removed,
        new_keywords: newKeywords,
      });
      await cover.uploadCoverIfAny(out.item.id);
      // Best-effort: re-fetch the item so we get full context lists, then redirect.
      try {
        await getItem(out.item.id);
      } catch {
        // ignore — the redirect is what matters
      }
      router.push(`/items/${out.item.id}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }
  function toggleProposal(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function addFromSearch(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  if (step === "draft") {
    return (
      <AdminItemFormDraftStep
        fields={fields}
        setFields={setFields}
        submitting={submitting}
        saveMode={saveMode}
        error={error}
        handleDraft={handleDraft}
        handleSave={handleSave}
        cover={cover}
      />
    );
  }
  // step === "review"
  return (
    <AdminItemFormReviewStep
      draftResult={draftResult}
      itemName={fields.name}
      selectedIds={selectedIds}
      toggleProposal={toggleProposal}
      addFromSearch={addFromSearch}
      submitting={submitting}
      error={error}
      handleCommit={handleCommit}
      onBack={() => {
        setStep("draft");
        setError(null);
      }}
    />
  );
}
