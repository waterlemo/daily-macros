import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Build the Daily Macros Tencent SCF Web package.")
parser.add_argument("output", type=Path, help="Path for the new ZIP file")
args = parser.parse_args()
dependencies = project / "node_modules"
if not (dependencies / "cos-nodejs-sdk-v5/package.json").is_file():
    parser.error("Run npm ci --omit=dev before building the SCF package.")
args.output.parent.mkdir(parents=True, exist_ok=True)

with ZipFile(args.output, "x", ZIP_DEFLATED) as archive:
    bootstrap = ZipInfo("scf_bootstrap")
    bootstrap.create_system = 3
    bootstrap.external_attr = 0o100755 << 16
    bootstrap.compress_type = ZIP_DEFLATED
    archive.writestr(bootstrap, (project / "deploy/scf_bootstrap").read_text(encoding="utf-8"))
    for source in ("server/tencent.mjs", "server/api.mjs", "server/cos-store.mjs", "docs/domain.mjs"):
        archive.write(project / source, source)
    for source in sorted(dependencies.rglob("*")):
        relative = source.relative_to(dependencies)
        if source.is_file() and not any(part.startswith(".") for part in relative.parts):
            archive.write(source, source.relative_to(project).as_posix())

print(args.output.resolve())
