"use server"

import { resetPlatformAccountPassword } from "@chatbotx.io/auth/provisioning"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { getTranslations } from "next-intl/server"
import { superAdminActionClient } from "@/lib/safe-action"
import { resetAdminUserPasswordRequest } from "../schema/mutation"

export const resetAdminUserPasswordAction = superAdminActionClient
  .inputSchema(resetAdminUserPasswordRequest)
  .action(async ({ ctx, parsedInput }) => {
    if (parsedInput.userId === ctx.user.id) {
      const t = await getTranslations()
      throw new ChatbotXException(
        t("platformAdmin.users.cannotResetOwnPassword"),
        "cannotResetOwnPassword",
        400,
      )
    }
    return await resetPlatformAccountPassword({ userId: parsedInput.userId })
  })
