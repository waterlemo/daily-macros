import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Build the Daily Macros Tencent SCF Web package.")
parser.add_argument("output", type=Path, help="Path for the new ZIP file")
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)

with ZipFile(args.output, "x", ZIP_DEFLATED) as archive:
    bootstrap = ZipInfo("scf_bootstrap")
    bootstrap.create_system = 3
    bootstrap.external_attr = 0o100755 << 16
    bootstrap.compress_type = ZIP_DEFLATED
    archive.writestr(bootstrap, (project / "deploy/scf_bootstrap").read_text(encoding="utf-8"))
    for source in ("server/tencent.mjs", "server/api.mjs", "docs/domain.mjs"):
        archive.write(project / source, source)

print(args.output.resolve())
