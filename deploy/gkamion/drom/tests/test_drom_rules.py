"""Детерминированная приёмка обязательных ДРОМ-правил профиля."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]/'profile'

class DromRules(unittest.TestCase):
    def test_soul_has_mandatory_channel_rule(self):
        s = (ROOT / 'SOUL.md').read_text()
        self.assertIn('ДРОМ: карточка и прикреплённая сделка', s)
        self.assertIn('references/drom.md', s)

    def test_drom_reference_has_trade_safety_and_identity(self):
        p = ROOT / 'skills/geka-knowledge/references/drom.md'
        self.assertTrue(p.exists(), 'нет отдельного сценария ДРОМ')
        s = p.read_text()
        for term in ['0-5', 'минимальн', 'цене ДРОМ', 'отмена', 'повтор', 'карточка', 'сделка', 'email', 'проверенн']:
            self.assertIn(term, s, term)

    def test_reference_is_in_both_indexes(self):
        for file in ['skills/geka-knowledge/dialog-rules.md', 'skills/geka-knowledge/SKILL.md']:
            self.assertIn('references/drom.md', (ROOT/file).read_text(), file)

    def test_channels_does_not_restart_ordinary_selection_for_card(self):
        s = (ROOT/'skills/geka-knowledge/references/channels.md').read_text()
        self.assertIn('references/drom.md', s)
        self.assertNotIn('Если клиент прислал ссылку на объявление с артикулом — действуй по сценарию подбора из', s)

if __name__ == '__main__':
    unittest.main(verbosity=2)
