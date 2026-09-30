import importlib.util
import re
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "ren_package_extension",
    ROOT / "scripts" / "package_extension.py",
)
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class PackageExtensionTest(unittest.TestCase):
    def test_archive_is_deterministic_and_contains_only_runtime_files(self):
        with tempfile.TemporaryDirectory(prefix="ren-package-test-") as directory:
            first = Path(directory) / "first.zip"
            second = Path(directory) / "second.zip"
            PACKAGE.build_archive(first)
            PACKAGE.build_archive(second)

            self.assertEqual(first.read_bytes(), second.read_bytes())
            with ZipFile(first) as archive:
                names = archive.namelist()
                self.assertEqual(names, sorted(PACKAGE.RUNTIME_FILES))
                for name in names:
                    self.assertEqual(archive.read(name), (ROOT / name).read_bytes())
                for reference in re.findall(r'url\(["\']?([^"\')]+)', (ROOT / "styles.css").read_text()):
                    self.assertIn(reference, names, f"Missing CSS asset: {reference}")


if __name__ == "__main__":
    unittest.main()
