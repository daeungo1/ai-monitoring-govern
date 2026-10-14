import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  tableNumericClass,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { TableParams } from "@/types/dashboard";

export type ServerSortableColumnId<T> = Extract<keyof T, string>;

export interface ServerTableProps<TRow extends object> {
  /** Column defs from @tanstack/react-table. */
  columns: ColumnDef<TRow, unknown>[];
  rows: readonly TRow[];
  totalRows: number;
  table: TableParams;
  onTableChange: (next: TableParams) => void;
  /** Loading state — shows a thin skeleton overlay. */
  isFetching?: boolean;
  /** A short caption shown above the pager. */
  caption?: string;
  /** Default page size if unset. */
  defaultPageSize?: number;
}

/**
 * Server-driven TanStack Table wrapper:
 * - Sort/pagination state lives in TableParams and is pushed back via `onTableChange`.
 * - Column meta `{ sortKey }` flags server-sortable columns (sortKey is what the API expects).
 */
export function ServerTable<TRow extends object>({
  columns,
  rows,
  totalRows,
  table,
  onTableChange,
  isFetching,
  caption,
  defaultPageSize = 25,
}: ServerTableProps<TRow>) {
  const pageSize = table.pageSize ?? defaultPageSize;
  const page = table.page ?? 1;

  const sorting = useMemo<SortingState>(() => {
    if (!table.sort) return [];
    return [{ id: table.sort, desc: table.dir !== "asc" }];
  }, [table.sort, table.dir]);

  const t = useReactTable({
    data: rows as TRow[],
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(totalRows / pageSize)),
    getCoreRowModel: getCoreRowModel(),
  });

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("overflow-x-auto rounded-md border border-border", isFetching && "opacity-60")}>
        <Table>
          <TableHeader>
            {t.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const sortKey = (h.column.columnDef.meta as { sortKey?: string } | undefined)
                    ?.sortKey;
                  const isNumeric = (h.column.columnDef.meta as { numeric?: boolean } | undefined)
                    ?.numeric;
                  const isSorted = sortKey && table.sort === sortKey;
                  const dir = table.dir ?? "desc";
                  return (
                    <TableHead
                      key={h.id}
                      className={cn(isNumeric && tableNumericClass, "select-none")}
                    >
                      {sortKey ? (
                        <button
                          type="button"
                          onClick={() => {
                            const nextDir =
                              isSorted && dir === "desc" ? "asc" : "desc";
                            onTableChange({
                              ...table,
                              sort: sortKey,
                              dir: nextDir,
                              page: 1,
                            });
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground",
                            isSorted && "text-foreground",
                            isNumeric ? "justify-end w-full" : "",
                          )}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {isSorted ? (
                            dir === "desc" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )
                          ) : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  No rows in this range.
                </TableCell>
              </TableRow>
            ) : (
              t.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const isNumeric = (cell.column.columnDef.meta as { numeric?: boolean } | undefined)
                      ?.numeric;
                    return (
                      <TableCell key={cell.id} className={cn(isNumeric && tableNumericClass)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {caption ? `${caption} · ` : ""}Page {page} of {totalPages} · {totalRows.toLocaleString()} rows
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={page <= 1}
            onClick={() => onTableChange({ ...table, page: Math.max(1, page - 1) })}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={page >= totalPages}
            onClick={() => onTableChange({ ...table, page: Math.min(totalPages, page + 1) })}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Convenience hook for per-route table state. */
export function useTableState(initial: TableParams = { page: 1, pageSize: 25 }) {
  return useState<TableParams>(initial);
}
