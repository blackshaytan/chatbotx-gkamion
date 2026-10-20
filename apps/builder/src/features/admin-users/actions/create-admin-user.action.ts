"use server"

import { provisionPlatformAccount } from "@chatbotx.io/auth/provisioning"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { getTranslations } from "next-intl/server"
import { superAdminActionClient } from "@/lib/safe-action"
import { createAdminUserRequest } from "../schema/mutation"

export const createAdminUserAction = superAdminActionClient
  .inputSchema(createAdminUserRequest)
  .action(async ({ parsedInput }) => {
    try {
      return await provisionPlatformAccount(parsedInput)
    } catch (error) {
      if (
        error instanceof ChatbotXException &&
        error.code === "userAlreadyExists"
      ) {
        const t = await getTranslations()
        throw new ChatbotXException(
          t("platformAdmin.users.userAlreadyExists"),
          error.code,
          409,
        )
      }
      throw error
    }
  })
