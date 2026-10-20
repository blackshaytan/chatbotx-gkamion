import {
  platformCredentialService,
  resolveTenantSettingsByOwner,
  workspaceService,
} from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import {
  and,
  type DatabaseClient,
  db,
  eq,
  isUniqueViolationError,
} from "@chatbotx.io/database/client"
import { ROOT_TENANT_ID } from "@chatbotx.io/database/partials"
import {
  accountModel,
  sessionModel,
  userModel,
} from "@chatbotx.io/database/schema"
import {
  DEFAULT_ACCOUNT_CREDENTIALS_SUBJECT,
  sendAccountCredentials,
} from "@chatbotx.io/mail"
import { generateRandomString, hashPassword } from "better-auth/crypto"
import { isPlaceholderEmail } from "./placeholder-email"

const TEMP_PASSWORD_LENGTH = 16

const generateTemporaryPassword = () =>
  generateRandomString(TEMP_PASSWORD_LENGTH, "a-z", "A-Z", "0-9")

/** A verified `User` plus its credential `Account`, forced to change the password on first sign-in. */
const insertCredentialUser = async (
  tx: DatabaseClient,
  input: {
    email: string
    name: string
    tenantId: string
    hashedPassword: string
  },
): Promise<string> => {
  const [createdUser] = await tx
    .insert(userModel)
    .values({
      email: input.email,
      name: input.name,
      emailVerified: true,
      mustChangePassword: true,
      tenantId: input.tenantId,
    })
    .returning({ id: userModel.id })

  if (!createdUser) {
    throw new ChatbotXException(
      "Failed to create provisioned user",
      "provisionFailed",
      500,
    )
  }

  await tx.insert(accountModel).values({
    accountId: createdUser.id,
    providerId: "credential",
    password: input.hashedPassword,
    userId: createdUser.id,
    tenantId: input.tenantId,
  })

  return createdUser.id
}

export type ProvisionResellerAccountInput = {
  /** The reseller (white-label owner) provisioning the account. */
  resellerUserId: string
  /** End-customer's login email. Unique per tenant, not globally. */
  email: string
  /** End-customer's display name. */
  name: string
  /** Live vs test credential selector; defaults to test. */
  livemode?: boolean
  /** Override the sign-in link; defaults to the reseller's branded app URL. */
  signInUrl?: string
}

export type ProvisionResellerAccountResult = {
  userId: string
  /** True when a matching user already existed — no row created, no email sent. */
  alreadyExisted: boolean
}

/**
 * Provision an end-customer sub-account for a reseller: create a tenant-scoped
 * `User` + credential `Account` with a generated temporary password, force a
 * password change on first sign-in, and email the credentials over the
 * reseller's own SMTP so the message stays in their domain.
 *
 * Hard-fails before creating anything if the reseller has no SMTP credential of
 * their own (no platform fallback) — the branded-email guarantee is the whole
 * point of the feature. Idempotent on `(email, tenantId)`.
 */
export async function provisionResellerAccount(
  input: ProvisionResellerAccountInput,
): Promise<ProvisionResellerAccountResult> {
  const { resellerUserId, email, name } = input
  const livemode = input.livemode ?? false

  // The Facebook placeholder domain belongs to phone-only Facebook users; a
  // verified row on it would capture that person's Facebook sign-in while the
  // reseller's temporary password keeps working.
  if (isPlaceholderEmail(email)) {
    throw new ChatbotXException(
      "Email address is reserved and cannot be provisioned",
      "invalidEmail",
      400,
    )
  }

  // 1. Resolve the reseller's OWN SMTP credential first. `findDecryptedForUser`
  //    (not `resolveForOwner`) deliberately skips the platform fallback so a
  //    missing reseller credential hard-fails instead of leaking the platform
  //    sender.
  const smtp = await platformCredentialService.findDecryptedForUser({
    userId: resellerUserId,
    type: "smtp",
    livemode,
  })
  if (!smtp) {
    throw new ChatbotXException(
      "Reseller has no SMTP credential configured; cannot send account credentials",
      "smtpCredentialMissing",
      400,
    )
  }

  // 2. Derive the tenant the sub-account belongs to (owner-derived, never from
  //    request input — see docs/tenancy.md).
  const tenantId = await workspaceService.resolveTenantForOwner(resellerUserId)

  // 3. Idempotency: email is unique per tenant. If the account already exists,
  //    do not recreate it or re-send (the temp password is only known at
  //    creation time).
  const existing = await db.query.userModel.findFirst({
    where: { email, tenantId },
    columns: { id: true },
  })
  if (existing) {
    return { userId: existing.id, alreadyExisted: true }
  }

  // 4. Generate + hash a temporary password using better-auth's own hasher so
  //    the credential verifies on first sign-in.
  const initialPassword = generateTemporaryPassword()
  const hashedPassword = await hashPassword(initialPassword)

  // 5. Resolve branding + sign-in link for the credentials email.
  const settings = await resolveTenantSettingsByOwner(resellerUserId)

  const signInUrl =
    input.signInUrl ?? new URL("/auth/sign-in", settings.appUrl).toString()

  // 6. Email the credentials BEFORE creating the account. Sending over a
  //    reseller-controlled SMTP host is the failure-prone step (bad host, auth
  //    rejected, recipient refused); if it throws here nothing has been written,
  //    so a retry cleanly re-provisions with a fresh password. The reverse order
  //    would commit the account and then lose the only copy of the temporary
  //    password on an SMTP error, orphaning the customer with no way back in.
  await sendAccountCredentials(
    email,
    {
      brandName: settings.name,
      brandLogoUrl: settings.logoLightUrl,
      brandUrl: settings.appUrl,
      subject: DEFAULT_ACCOUNT_CREDENTIALS_SUBJECT,
      customTemplate: settings.accountCredentialsEmailTemplate,
      userName: name,
      loginEmail: email,
      initialPassword,
      signInUrl,
    },
    {
      host: smtp.config.host,
      port: smtp.config.port,
      username: smtp.config.username,
      password: smtp.config.password,
      fromEmail: smtp.config.fromEmail,
      fromName: smtp.config.fromName,
    },
  )

  // 7. Create the user + credential account in one transaction. Business-layer
  //    `db` is NOT tenant-scoped, so `tenantId` is stamped explicitly on both.
  //    A concurrent provision of the same (email, tenantId) can slip between the
  //    idempotency check in step 3 and this insert; the unique index
  //    `User_email_tenant_key` rejects the loser, so translate that into the
  //    idempotent `alreadyExisted` result instead of surfacing a raw 23505.
  try {
    const userId = await db.transaction((tx) =>
      insertCredentialUser(tx, { email, name, tenantId, hashedPassword }),
    )

    return { userId, alreadyExisted: false }
  } catch (error) {
    if (isUniqueViolationError(error)) {
      const raced = await db.query.userModel.findFirst({
        where: { email, tenantId },
        columns: { id: true },
      })
      if (raced) {
        return { userId: raced.id, alreadyExisted: true }
      }
    }
    throw error
  }
}

export type PlatformAccountCredentials = {
  userId: string
  /** Shown to the platform admin once; only its hash is stored. */
  temporaryPassword: string
}

const userAlreadyExistsException = () =>
  new ChatbotXException(
    "A user with this email already exists",
    "userAlreadyExists",
    409,
  )

/**
 * Create a root-tenant account for the platform admin console. Unlike
 * `provisionResellerAccount` nothing is emailed: the temporary password is
 * returned so the admin can hand it over, and the user must change it on first
 * sign-in.
 */
export async function provisionPlatformAccount(input: {
  email: string
  name: string
}): Promise<PlatformAccountCredentials> {
  const email = input.email.trim().toLowerCase()
  if (isPlaceholderEmail(email)) {
    throw new ChatbotXException(
      "Email address is reserved and cannot be provisioned",
      "invalidEmail",
      400,
    )
  }

  const existing = await db.query.userModel.findFirst({
    where: { email, tenantId: ROOT_TENANT_ID },
    columns: { id: true },
  })
  if (existing) {
    throw userAlreadyExistsException()
  }

  const temporaryPassword = generateTemporaryPassword()
  const hashedPassword = await hashPassword(temporaryPassword)

  try {
    const userId = await db.transaction((tx) =>
      insertCredentialUser(tx, {
        email,
        name: input.name,
        tenantId: ROOT_TENANT_ID,
        hashedPassword,
      }),
    )
    return { userId, temporaryPassword }
  } catch (error) {
    if (isUniqueViolationError(error)) {
      throw userAlreadyExistsException()
    }
    throw error
  }
}

/**
 * Replace a root-tenant user's password with a new temporary one, force a
 * change on next sign-in and drop every session. A user who only signed in
 * with a social provider gets a credential account added.
 */
export async function resetPlatformAccountPassword(input: {
  userId: string
}): Promise<PlatformAccountCredentials> {
  const user = await db.query.userModel.findFirst({
    where: { id: input.userId, tenantId: ROOT_TENANT_ID },
    columns: { id: true },
  })
  if (!user) {
    throw new ChatbotXException("User not found", "notFound", 404)
  }

  const temporaryPassword = generateTemporaryPassword()
  const hashedPassword = await hashPassword(temporaryPassword)

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(accountModel)
      .set({ password: hashedPassword })
      .where(
        and(
          eq(accountModel.userId, user.id),
          eq(accountModel.providerId, "credential"),
        ),
      )
      .returning({ id: accountModel.id })

    if (updated.length === 0) {
      await tx.insert(accountModel).values({
        accountId: user.id,
        providerId: "credential",
        password: hashedPassword,
        userId: user.id,
        tenantId: ROOT_TENANT_ID,
      })
    }

    await tx
      .update(userModel)
      .set({ mustChangePassword: true })
      .where(eq(userModel.id, user.id))
    await tx.delete(sessionModel).where(eq(sessionModel.userId, user.id))
  })

  return { userId: user.id, temporaryPassword }
}
