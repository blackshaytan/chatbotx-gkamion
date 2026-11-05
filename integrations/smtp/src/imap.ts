import { ImapFlow } from "imapflow"
import {
  resolveImapEndpoint,
  type SmtpAuthValue,
  smtpReceiveEnabled,
} from "./schema"

export type ImapFetchedMessage = { uid: number; source: Buffer }

export type OpenedInbox = {
  uidValidity: number
  uidNext: number
  fetchSince: (lastUid: number) => AsyncIterable<ImapFetchedMessage>
  close: () => Promise<void>
}

const clientOptions = (auth: SmtpAuthValue, host: string, port: number) => ({
  host,
  port,
  secure: port === 993,
  auth: { user: auth.username, pass: auth.password },
  logger: false as const,
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 30_000,
  // A mailbox the user typed in ("other") often has a certificate Node does not
  // trust. Known providers keep normal verification. Without this, STARTTLS on
  // port 143 fails before the password is checked.
  ...(auth.provider === "other" ? { tls: { rejectUnauthorized: false } } : {}),
})

export const verifyImapLogin = async (auth: SmtpAuthValue): Promise<void> => {
  if (!smtpReceiveEnabled(auth)) {
    return
  }
  const endpoint = resolveImapEndpoint(auth)
  if (!endpoint) {
    return
  }
  const client = new ImapFlow(clientOptions(auth, endpoint.host, endpoint.port))
  try {
    await client.connect()
    await client.logout()
  } catch (error) {
    try {
      await client.close()
    } catch {
      // The original login error is the one the caller should see.
    }
    throw error
  }
}

export const openImapInbox = async (
  auth: SmtpAuthValue,
): Promise<OpenedInbox> => {
  const endpoint = resolveImapEndpoint(auth)
  if (!endpoint) {
    throw new Error("This SMTP provider has no mailbox to receive mail")
  }
  const client = new ImapFlow(clientOptions(auth, endpoint.host, endpoint.port))
  try {
    await client.connect()
    const lock = await client.getMailboxLock("INBOX", { readOnly: true })
    const mailbox = client.mailbox
    if (!mailbox) {
      lock.release()
      throw new Error("IMAP mailbox is not open")
    }
    return {
      uidValidity: Number(mailbox.uidValidity),
      uidNext: Number(mailbox.uidNext),
      fetchSince: (lastUid: number) =>
        client.fetch(
          `${lastUid + 1}:*`,
          { uid: true, source: true },
          { uid: true },
        ) as AsyncIterable<ImapFetchedMessage>,
      close: async () => {
        lock.release()
        try {
          await client.logout()
        } catch {
          await client.close()
        }
      },
    }
  } catch (error) {
    try {
      await client.logout()
    } catch {
      await client.close()
    }
    throw error
  }
}
