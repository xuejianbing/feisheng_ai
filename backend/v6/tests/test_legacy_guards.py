import pathlib,subprocess,sys,unittest
from test_trusted import ROOT
class Legacy(unittest.TestCase):
    def test_fit_prepare_and_policy_exports_fail_before_side_effects(self):
        targets=[]
        explicit={'P0_Baseline_Prepare.py','P0_Step3_Prepare.py','Export_Client_Policy_JS.py','P1_Export_Slot17_JS.py','P0_Basic_Rule_Mine.py','P1_ComboRules_Build.py'}
        for p in (ROOT/'training').glob('*.py'):
            text=p.read_text(encoding='utf-8-sig')
            if '.fit(' in text or p.name in explicit:targets.append(p)
        self.assertGreater(len(targets),10)
        for p in targets:
            with self.subTest(path=p.name):
                # Check before running unknown legacy code: no old data path may execute.
                text=p.read_text(encoding='utf-8-sig');self.assertIn('require_trusted_training_adapter()',text)
                result=subprocess.run([sys.executable,str(p)],capture_output=True,text=True)
                self.assertNotEqual(result.returncode,0);self.assertIn('E_LEGACY_TRAINING_BLOCKED',result.stderr)
        print('Blocked legacy trainer/preparation/export entries:',len(targets))
if __name__=='__main__':unittest.main(verbosity=2)
