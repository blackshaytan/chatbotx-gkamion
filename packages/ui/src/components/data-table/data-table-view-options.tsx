"use client"

import type { Table } from "@tanstack/react-table"
import { Check, ChevronsUpDown, Settings2 } from "lucide-react"
import * as React from "react"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@chatbotx.io/ui/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chatbotx.io/ui/components/ui/popover"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { useUiLabels } from "@chatbotx.io/ui/components/ui-labels"

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  const uiLabels = useUiLabels()
  const columns = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter(
          (column) =>
            typeof column.accessorFn !== "undefined" && column.getCanHide(),
        ),
    [table],
  )

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={uiLabels.toggleColumns}
            // biome-ignore lint/a11y/useSemanticElements: <explanation>
            role="combobox"
            variant="outline"
            size="sm"
            className="ms-auto hidden h-8 lg:flex"
          >
            <Settings2 />
            {uiLabels.view}
            <ChevronsUpDown className="ms-auto opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-44 p-0">
        <Command>
          <CommandInput placeholder={uiLabels.searchColumns} />
          <CommandList>
            <CommandEmpty>{uiLabels.noColumnsFound}</CommandEmpty>
            <CommandGroup>
              {columns.map((column) => (
                <CommandItem
                  key={column.id}
                  onSelect={() =>
                    column.toggleVisibility(!column.getIsVisible())
                  }
                >
                  <span className="truncate">
                    {column.columnDef.meta?.label ?? column.id}
                  </span>
                  <Check
                    className={cn(
                      "ms-auto size-4 shrink-0",
                      column.getIsVisible() ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
