"use client"

import type { SendOrderNotificationStepSchema } from "@chatbotx.io/flow-config"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { Card, CardContent } from "@chatbotx.io/ui/components/ui/card"
import { MessagesSquareIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { BaseStateViewer } from "../../states/viewer"
import { BaseStepViewer } from "../base/viewer"

const subjectLabelKey = {
  order: "fields.orderNotification.subject.order",
  item: "fields.orderNotification.subject.item",
} as const

const SendOrderNotificationStepViewer = ({
  data,
}: {
  data: SendOrderNotificationStepSchema
}) => {
  const t = useTranslations()

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="p-0">
        <div className="flex flex-col gap-2 px-4 py-2">
          <BaseStepViewer
            icon={MessagesSquareIcon}
            title={t("flows.actions.sendOrderNotification")}
          />
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">
              {t(subjectLabelKey[data.subject])}
            </Badge>
            {data.statusIds.map((statusId) => (
              <Badge key={statusId} variant="outline">
                {statusId}
              </Badge>
            ))}
          </div>
        </div>
        <div className="my-2 me-3 flex flex-col gap-1">
          {data.states.map((state) => (
            <BaseStateViewer data={state} key={state.id} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default SendOrderNotificationStepViewer
