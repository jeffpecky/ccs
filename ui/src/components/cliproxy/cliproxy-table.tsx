/**
 * CLIProxy Variants Table Component
 * Phase 03: REST API Routes & CRUD
 * Phase 05: Dashboard UI full CRUD for composite variants
 * Phase 06: Multi-Account Support
 */

import { useState } from 'react';
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Trash2, User, Pencil } from 'lucide-react';
import { useDeleteVariant } from '@/hooks/use-cliproxy';
import { CliproxyEditDialog } from './cliproxy-edit-dialog';
import type { Variant } from '@/lib/api-client';
import { getProviderDisplayName } from '@/lib/provider-config';
import { useTranslation } from 'react-i18next';

interface CliproxyTableProps {
  data: Variant[];
}

export function CliproxyTable({ data }: CliproxyTableProps) {
  const deleteMutation = useDeleteVariant();
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const { t } = useTranslation();

  const columns: ColumnDef<Variant>[] = [
    {
      accessorKey: 'name',
      header: t('cliproxyTable.name'),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: 'provider',
      header: t('cliproxyTable.provider'),
      cell: ({ row }) => {
        if (row.original.type === 'composite') {
          return <Badge variant="secondary">{t('providerEditor.composite')}</Badge>;
        }
        return getProviderDisplayName(row.original.provider);
      },
    },
    {
      accessorKey: 'account',
      header: t('cliproxyTable.account'),
      cell: ({ row }) => {
        const account = row.original.account;
        if (!account) {
          return (
            <span className="text-muted-foreground text-xs italic">
              {t('providerEditor.defaultLabel')}
            </span>
          );
        }
        return (
          <Badge variant="secondary" className="text-xs font-normal">
            <User className="w-3 h-3 mr-1 opacity-70" />
            {account}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'target',
      header: 'Target',
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5 uppercase">
          {row.original.target || 'claude'}
        </Badge>
      ),
    },
    {
      accessorKey: 'settings',
      header: 'Settings Path',
      cell: ({ row }) => (
        <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {row.original.settings || `config.cliproxy.${row.original.name}`}
        </code>
      ),
    },
    {
      id: 'actions',
      header: t('cliproxyTable.actions'),
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-white dark:bg-zinc-950">
              <DropdownMenuItem onClick={() => setEditingVariant(row.original)}>
                <Pencil className="w-4 h-4 mr-2" />
                {/* TODO i18n: missing key for "Edit" */}
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30"
                onClick={() => deleteMutation.mutate(row.original.name)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {/* TODO i18n: missing key for "Delete" */}
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (data.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-muted/5 border-dashed">
        <div className="text-muted-foreground text-sm">{t('cliproxyHeader.noVariants')}</div>
        <div className="text-xs text-muted-foreground mt-1">
          Create one to use OAuth-based providers with specific account configurations.
        </div>
      </div>
    );
  }

  return (
    <>
      <CliproxyEditDialog
        variant={editingVariant}
        open={!!editingVariant}
        onOpenChange={(open) => !open && setEditingVariant(null)}
      />
      <div className="border rounded-md overflow-hidden bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
