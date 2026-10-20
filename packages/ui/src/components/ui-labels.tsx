"use client"

import { createContext, useContext } from "react"

export type UiLabels = {
  close: string
  clear: string
  reset: string
  noResults: string
  noResultsFound: string
  selectedRows: (selected: number, total: number) => string
  rowsPerPage: string
  pageOf: (page: number, pageCount: number) => string
  firstPage: string
  previousPage: string
  nextPage: string
  lastPage: string
  sortAscending: string
  sortDescending: string
  hideColumn: string
  selectedCount: (count: number) => string
  clearFilters: string
  resetFilters: string
  selectDate: string
  selectDateRange: string
  rangeFrom: string
  rangeTo: string
  rangeSlider: (title: string) => string
  clearFilter: (title: string) => string
  view: string
  toggleColumns: string
  searchColumns: string
  noColumnsFound: string
  noEmojiFound: string
  selectEmoji: string
  previousSlide: string
  nextSlide: string
  increaseValue: string
  decreaseValue: string
  searchOptions: string
  selectAll: (optionCount: number) => string
  toggleSidebar: string
  sidebarTitle: string
  sidebarDescription: string
  uploadFile: string
  uploadFailed: string
  uploadUnexpectedError: string
}

export const defaultUiLabels: UiLabels = {
  close: "Close",
  clear: "Clear",
  reset: "Reset",
  noResults: "No results.",
  noResultsFound: "No results found.",
  selectedRows: (selected, total) => `${selected} of ${total} row(s) selected.`,
  rowsPerPage: "Rows per page",
  pageOf: (page, pageCount) => `Page ${page} of ${pageCount}`,
  firstPage: "Go to first page",
  previousPage: "Go to previous page",
  nextPage: "Go to next page",
  lastPage: "Go to last page",
  sortAscending: "Asc",
  sortDescending: "Desc",
  hideColumn: "Hide",
  selectedCount: (count) => `${count} selected`,
  clearFilters: "Clear filters",
  resetFilters: "Reset filters",
  selectDate: "Select date",
  selectDateRange: "Select date range",
  rangeFrom: "From",
  rangeTo: "to",
  rangeSlider: (title) => `${title} slider`,
  clearFilter: (title) => `Clear ${title} filter`,
  view: "View",
  toggleColumns: "Toggle columns",
  searchColumns: "Search columns...",
  noColumnsFound: "No columns found.",
  noEmojiFound: "No emoji found.",
  selectEmoji: "Select an emoji…",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  increaseValue: "Increase value",
  decreaseValue: "Decrease value",
  searchOptions: "Search options...",
  selectAll: (optionCount) =>
    optionCount > 20 ? `(Select All - ${optionCount} options)` : "(Select All)",
  toggleSidebar: "Toggle Sidebar",
  sidebarTitle: "Sidebar",
  sidebarDescription: "Displays the mobile sidebar.",
  uploadFile: "Upload File",
  uploadFailed: "Upload failed",
  uploadUnexpectedError: "An unexpected error occurred during upload",
}

const UiLabelsContext = createContext<UiLabels>(defaultUiLabels)

export const UiLabelsProvider = UiLabelsContext.Provider

export const useUiLabels = () => useContext(UiLabelsContext)

type UiLabelTextKey = {
  [Key in keyof UiLabels]: UiLabels[Key] extends string ? Key : never
}[keyof UiLabels]

export const UiLabelText = ({ name }: { name: UiLabelTextKey }) =>
  useUiLabels()[name]
