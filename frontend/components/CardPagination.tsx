"use client";

import React from "react";

import { CARD_PAGE_SIZE } from "@/lib/useCardPagination";

interface CardPaginationProps {
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  scrollTargetId?: string;
}

export function CardPagination({
  currentPage,
  totalItems,
  onPageChange,
  pageSize = CARD_PAGE_SIZE,
  scrollTargetId,
}: CardPaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages || nextPage === currentPage) return;
    onPageChange(nextPage);
    if (scrollTargetId) {
      window.requestAnimationFrame(() => {
        document.getElementById(scrollTargetId)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }

  return (
    <nav className="card-pagination" aria-label="เปลี่ยนหน้ารายการชุดการแสดง">
      <p className="card-pagination-summary">
        แสดง {start}–{end} จาก {totalItems} รายการ
      </p>
      <div className="card-pagination-controls">
        <button
          type="button"
          onClick={() => changePage(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="หน้าก่อนหน้า"
        >
          ← ก่อนหน้า
        </button>
        {pageTokens(currentPage, totalPages).map((token) =>
          typeof token === "number" ? (
            <button
              key={token}
              type="button"
              className={token === currentPage ? "active" : undefined}
              onClick={() => changePage(token)}
              aria-current={token === currentPage ? "page" : undefined}
              aria-label={`หน้า ${token}`}
            >
              {token}
            </button>
          ) : (
            <span key={token} className="card-pagination-ellipsis" aria-hidden="true">…</span>
          ),
        )}
        <button
          type="button"
          onClick={() => changePage(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="หน้าถัดไป"
        >
          ถัดไป →
        </button>
      </div>
    </nav>
  );
}

type PageToken = number | "ellipsis-left" | "ellipsis-right";

function pageTokens(currentPage: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-right", totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis-left", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ];
}
