"use client";

import { useEffect, useMemo, useState } from "react";

export const CARD_PAGE_SIZE = 10;

export function useCardPagination<T>(
  items: T[],
  resetKey = "",
  pageSize = CARD_PAGE_SIZE,
) {
  const [rawPage, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(rawPage, totalPages);
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, items.length);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pageItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex],
  );

  return {
    page,
    setPage,
    pageItems,
    totalPages,
    startIndex,
    endIndex,
  };
}
