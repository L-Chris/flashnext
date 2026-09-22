import json,sqlite3,subprocess,tempfile,unittest,sys,hashlib
from pathlib import Path
S=Path(__file__).resolve().parents[1];sys.path.insert(0,str(S/'lib'))
from pronunciation import normalize
class Rules(unittest.TestCase):
 def test_not_convert_accent_or_narrow(self):
  for raw,tags in [('/ˈbɝd/',['General-American']),('[ˈtʰɪi̯t͡ʃəː]',['Received-Pronunciation']),('/ɹə-/',['Received-Pronunciation']),('/ˈtiːtʃəː/',['Received-Pronunciation'])]:self.assertFalse(normalize(raw,tags)[1])
 def test_common_and_weak_vowels(self):
  for raw,want in [('/deɪ̯/','deɪ'),('/ˈbɛd/','bed'),('/ˈhæpi/','ˈhæpi'),('/ɪnˈvaɪ.ɹən.mənt/','ɪnˈvaɪrənmənt')]:self.assertEqual(normalize(raw,['Received-Pronunciation'])[1],want)
 def test_qualifiers_forms(self):
  self.assertFalse(normalize('/baʊ/',['UK'],'archaic')[1]);self.assertFalse(normalize('/ɹɛd/',['UK'],form=True)[1])

if __name__=='__main__':unittest.main()
