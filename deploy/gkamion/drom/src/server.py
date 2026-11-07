#!/usr/bin/env python3
"""DROM MCP. Default read-only release gate; no raw HTTP or send tools."""
import hashlib
import json
import os
import time
from pathlib import Path
from mcp.server.fastmcp import FastMCP
from drom_tools import DromTools
from drom_transport import DromTransport

ROOT = Path(__file__).parent
GENERATION = hashlib.sha256(b''.join((ROOT / n).read_bytes() for n in
    ['drom_tools.py', 'drom_checkout.py', 'drom_transport.py', 'server.py', 'run.sh'])).hexdigest()
# The exact reviewed generation must be explicitly released by the owner.
# No tool can change this flag. Unset in production and in the release artifact.
WRITES_ENABLED = os.environ.get('DROM_WRITE_RELEASE_SHA256', '') == GENERATION
STATE = Path(os.environ.get('DROM_STATE_DIR', '/opt/hermes-data/profiles/assistant/cache/drom-tools'))
mcp = FastMCP('geka-drom')
_engine = None


def engine():
    global _engine
    if _engine is None:
        _engine = DromTools(DromTransport(write_enabled=WRITES_ENABLED), STATE)
    return _engine


def safe(fn):
    try:
        return fn()
    except ValueError as exc:
        return {'ok': False, 'error': str(exc), 'client_hint': 'Условие не выполнено. Не обходи защищённый ДРОМ-путь общими инструментами записи.'}
    except Exception as exc:
        return {'ok': False, 'error': type(exc).__name__, 'client_hint': 'Неясный результат: не повторяй запись вслепую; используй drom_checkout_status.'}


def write(fn):
    if not WRITES_ENABLED:
        return {'ok': False, 'error': 'release_blocked', 'client_hint': 'Запись ДРОМ отключена до приёмки выпуска; обход другими инструментами запрещён.'}
    return safe(fn)


@mcp.tool()
def drom_context(conversation_id: str, contact_id: str) -> dict:
    """Первым на ДРОМ: полная история именно этого контакта/диалога; native сделка, карточка, email, отмена/пауза. Только чтение. Не переспрашивай известное."""
    result = safe(lambda: engine().context(conversation_id, contact_id))
    return {**result, 'generation': GENERATION, 'release_mode': 'protected-writes' if WRITES_ENABLED else 'read-only-release-blocked'}


@mcp.tool()
def drom_price(context_ref: str, item_index: int = 0) -> dict:
    """Исходная позиция сделки: точный бренд/артикул, qty/min/stock, обе границы 0-5 дней. Цена поставщика <= ДРОМ: продажа по ДРОМ; выше: отдельное согласие на точное proposal_text/acceptance_text. Только чтение."""
    return safe(lambda: engine().quote(context_ref, item_index))


@mcp.tool()
def drom_extra_price(context_ref: str, request_message_id: str, article: str, brand: str, quantity: int) -> dict:
    """Дополнительная деталь по открытому запросу клиента из ЭТОЙ сделки. Собственные бренд/артикул/qty и цена выбранного оффера, без цены/qty исходной сделки. Только чтение. Затем drom_selection, показать весь proposal_text и дождаться точного acceptance_text."""
    return safe(lambda: engine().extra_quote(context_ref, request_message_id, article, brand, quantity))


@mcp.tool()
def drom_selection(context_ref: str, extra_offer_refs: list[str], dropped_request_ids: list[str], native_offer_refs: list[str] | None = None) -> dict:
    """Предложение ПОЛНОГО состава: исходные позиции и выбранные extras по своим ценам/qty, каждый открытый запрос включён или явно отклонён. native_offer_refs из drom_price нужны, если исходные корзины ещё не добавлены. Только локальное состояние. Покажи точный proposal_text; требуется последующее acceptance_text, произвольное «да» недостаточно. Любое новое сообщение клиента после согласия требует новой проверки состава."""
    return safe(lambda: engine().plan_quote(context_ref, extra_offer_refs, dropped_request_ids, native_offer_refs))


@mcp.tool()
def drom_basket(offer_ref: str, confirmed: bool = False) -> dict:
    """Защищённое добавление исходного либо extra offer_ref. Для extras нужен подтверждённый полный состав drom_selection; для повышения цены — точное согласие. Повтор не дублирует, неясный исход блокирует повтор. В текущем выпуске release_blocked до явной активации владельцем."""
    return write(lambda: engine().add(offer_ref, confirmed))


@mcp.tool()
def drom_checkout(context_ref: str, confirm: bool = False) -> dict:
    """Единственный разрешённый путь создания заказа ДРОМ, confirm=true. Сам сохраняет durable attempt ДО единственного POST, включает все согласованные позиции, проверяет showOrder: владельца, состав, цены, qty, поставщика/сроки, доставку. Только created_verified разрешает объявить номер/успех. outcome_unknown/readback_mismatch: НЕ повторять raw createOrder; drom_checkout_status читает результат. Запрещены счета, статусы и send. В текущем выпуске release_blocked."""
    return write(lambda: engine().checkout_create(context_ref, confirm))


@mcp.tool()
def drom_checkout_status(context_ref: str) -> dict:
    """Только чтение сохранённой попытки и принадлежащего покупателю результата. Не делает POST и не сбрасывает guard; допустимо после отмены/паузы при свежей подтверждённой личности."""
    return safe(lambda: engine().checkout_reconcile(context_ref))


@mcp.tool()
def drom_checkout_form(context_ref: str) -> dict:
    """Устаревший путь всегда заблокирован. Форма для внешнего raw createOrder не выдаётся; используй только защищённый drom_checkout после активации выпуска."""
    return {'ok': False, 'error': 'release_blocked: external form permanently disabled'}


if __name__ == '__main__':
    loaded = STATE / 'loaded'
    loaded.mkdir(parents=True, exist_ok=True, mode=0o700)
    (loaded / (str(os.getpid()) + '.json')).write_text(json.dumps({
        'pid': os.getpid(), 'ppid': os.getppid(), 'generation': GENERATION, 'loaded_at': time.time(),
        'release_mode': 'protected-writes' if WRITES_ENABLED else 'read-only-release-blocked'}))
    mcp.run()
