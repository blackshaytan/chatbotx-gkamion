import { Button } from "@chatbotx.io/ui/components/ui/button"
import Link from "next/link"
import { useTranslations } from "next-intl"

export default function WhatsappEcommerce({
  urls,
}: {
  urls: { ecommerce: string }
}) {
  const t = useTranslations()

  return (
    <div className="mt-6 flex flex-col items-center gap-6">
      <p className="text-2xl">{t("whatsapp.ecommerce.title")}</p>
      <Button size="sm" variant="secondary">
        <Link href={urls.ecommerce} target="_blank">
          {t("whatsapp.ecommerce.manageProducts")}
        </Link>
      </Button>
    </div>
  )
}
