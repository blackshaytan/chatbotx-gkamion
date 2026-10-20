"use client"

import {
  type UiLabels,
  UiLabelsProvider,
} from "@chatbotx.io/ui/components/ui-labels"
import { useTranslations } from "next-intl"
import { type ReactNode, useMemo } from "react"

const SELECT_ALL_COUNT_THRESHOLD = 20

/**
 * Feeds translated labels (`uiLabels.*`) to the shared components of
 * packages/ui (tables, dialogs, pickers), which have no i18n of their own.
 */
export function UiLabelsBridge({ children }: { children: ReactNode }) {
  const t = useTranslations("uiLabels")

  const labels = useMemo<UiLabels>(
    () => ({
      close: t("close"),
      clear: t("clear"),
      reset: t("reset"),
      noResults: t("noResults"),
      noResultsFound: t("noResultsFound"),
      selectedRows: (selected, total) => t("selectedRows", { selected, total }),
      rowsPerPage: t("rowsPerPage"),
      pageOf: (page, pageCount) => t("pageOf", { page, pageCount }),
      firstPage: t("firstPage"),
      previousPage: t("previousPage"),
      nextPage: t("nextPage"),
      lastPage: t("lastPage"),
      sortAscending: t("sortAscending"),
      sortDescending: t("sortDescending"),
      hideColumn: t("hideColumn"),
      selectedCount: (count) => t("selectedCount", { count }),
      clearFilters: t("clearFilters"),
      resetFilters: t("resetFilters"),
      selectDate: t("selectDate"),
      selectDateRange: t("selectDateRange"),
      rangeFrom: t("rangeFrom"),
      rangeTo: t("rangeTo"),
      rangeSlider: (title) => t("rangeSlider", { title }),
      clearFilter: (title) => t("clearFilter", { title }),
      view: t("view"),
      toggleColumns: t("toggleColumns"),
      searchColumns: t("searchColumns"),
      noColumnsFound: t("noColumnsFound"),
      noEmojiFound: t("noEmojiFound"),
      selectEmoji: t("selectEmoji"),
      previousSlide: t("previousSlide"),
      nextSlide: t("nextSlide"),
      increaseValue: t("increaseValue"),
      decreaseValue: t("decreaseValue"),
      searchOptions: t("searchOptions"),
      selectAll: (optionCount) =>
        optionCount > SELECT_ALL_COUNT_THRESHOLD
          ? t("selectAllWithCount", { count: optionCount })
          : t("selectAll"),
      toggleSidebar: t("toggleSidebar"),
      sidebarTitle: t("sidebarTitle"),
      sidebarDescription: t("sidebarDescription"),
      uploadFile: t("uploadFile"),
      uploadFailed: t("uploadFailed"),
      uploadUnexpectedError: t("uploadUnexpectedError"),
    }),
    [t],
  )

  return <UiLabelsProvider value={labels}>{children}</UiLabelsProvider>
}
