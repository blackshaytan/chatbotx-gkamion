type ChatLine = {
  id: string
  text: string
  direction?: "in" | "out"
  imageUrl?: string
}

const chatContainer = (line: ChatLine) => {
  const image = line.imageUrl
    ? `<ul class="bzr-dialog__image-list"><li><img src="${line.imageUrl}"/></li></ul>`
    : ""
  return (
    `<div class="bzr-dialog__msg-container" data-message-id="${line.id}">` +
    `<div class="bzr-dialog__message bzr-dialog__message_${line.direction ?? "in"}">` +
    '<span class="bzr-dialog__message-dt">17:13</span>' +
    `<span class="bzr-dialog__text">${line.text}</span>${image}` +
    "</div></div>"
  )
}

export const dealLine = (hash: string) =>
  `<div class="bzr-dialog__msg-container" data-hash="${hash}">` +
  '<div class="bzr-dialog__deal"><span class="bzr-dialog__deal-dt">12:13</span>' +
  " Покупатель выбрал Клапан ТНВД за 3 534₽</div></div>"

export const orderHeader = (dealId: string) =>
  '<h3 class="bzr-dialog-header__sub-title">' +
  `<a href="https://baza.drom.ru/deal/${dealId}">Заказ</a> • 3 534 р. • Клапан ТНВД</h3>`

/** `messaging/view?json=true` payload with the given chat lines. */
export const dialogView = (
  dialogId: string,
  lines: ChatLine[],
  options: { header?: string; extra?: string; interlocutor?: string } = {},
) => {
  const latest = lines.at(-1)?.id ?? ""
  return {
    dialog:
      `<div class="bzr-dialog" data-dialog-id="${dialogId}" data-latest-msg-id="${latest}">` +
      `${options.extra ?? ""}${lines.map(chatContainer).join("")}</div>`,
    header: options.header ?? "",
    interlocutor: options.interlocutor ?? "buyer-login",
  }
}

export const brief = (
  dialogId: string,
  options: {
    isUnread?: boolean
    highlighted?: boolean
    lastMessageDate?: number
    interlocutor?: string
  } = {},
) => ({
  dialogId,
  interlocutor: options.interlocutor ?? "10000009",
  isUnread: options.isUnread ?? false,
  lastMessageDate: options.lastMessageDate ?? 1_700_000_000,
  html: options.highlighted
    ? '<div class="dialog-brief dialog-brief_highlighted">'
    : '<div class="dialog-brief">',
})
