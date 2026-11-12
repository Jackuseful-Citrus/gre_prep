"""Build the offline materials catalog data from materials/manifest.json."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
MATERIALS = ROOT / "materials"


def main():
    manifest = json.loads((MATERIALS / "manifest.json").read_text(encoding="utf-8"))
    documents = []
    paths = set()
    for item in manifest["documents"]:
        path = item["path"]
        target = (ROOT / path).resolve()
        if not path.startswith("materials/") or not target.is_relative_to(MATERIALS.resolve()):
            raise ValueError(f"Material path must stay inside materials/: {path}")
        if not target.is_file():
            raise FileNotFoundError(path)
        if path in paths:
            raise ValueError(f"Duplicate material path: {path}")
        if item["category"] not in {"questions", "vocabulary", "reference"}:
            raise ValueError(f"Unknown category: {item['category']}")
        paths.add(path)
        documents.append({key: item[key] for key in ("path", "title", "category", "bytes", "aliases")})
    data = json.dumps({"version": 1, "documents": documents}, ensure_ascii=False, separators=(",", ":"))
    (MATERIALS / "catalog-data.js").write_text("window.GRE_MATERIALS=" + data + ";\n", encoding="utf-8")
    print(f"Offline material catalog generated: {len(documents)} documents.")


if __name__ == "__main__":
    main()
