"use client"

import Image from "next/image"
import { useFormatter, useTranslations } from "next-intl"

type CommentAttachmentsProps = {
  attachments: Array<{
    index: number
    mimeType: string
    name: string
    size: number
    url: string
  }>
}

export const CommentAttachments = ({
  attachments,
}: CommentAttachmentsProps) => {
  const t = useTranslations("tasks")
  const formatter = useFormatter()
  const formatFileSize = (size: number) =>
    size < 1024 * 1024
      ? formatter.number(Math.max(1, Math.round(size / 1024)), {
          style: "unit",
          unit: "kilobyte",
          unitDisplay: "short",
        })
      : formatter.number(size / (1024 * 1024), {
          style: "unit",
          unit: "megabyte",
          unitDisplay: "short",
          maximumFractionDigits: 1,
        })

  if (attachments.length === 0) {
    return null
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <li key={attachment.index}>
          {attachment.mimeType.startsWith("image/") ? (
            <a
              aria-label={t("feed.downloadAttachment", {
                name: attachment.name,
              })}
              href={attachment.url}
              rel="noopener"
              target="_blank"
            >
              <Image
                alt={attachment.name}
                className="size-20 rounded border object-cover"
                height={80}
                src={attachment.url}
                unoptimized
                width={80}
              />
            </a>
          ) : (
            <a
              className="inline-flex max-w-56 flex-col rounded border px-2 py-1 text-primary text-sm underline-offset-4 hover:underline"
              download={attachment.name}
              href={attachment.url}
            >
              <span className="truncate">{attachment.name}</span>
              <span className="text-muted-foreground text-xs">
                {formatFileSize(attachment.size)} · {t("feed.download")}
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
